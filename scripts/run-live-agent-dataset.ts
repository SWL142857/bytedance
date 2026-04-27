import { DeterministicLlmClient } from "../src/llm/deterministic-client.js";
import { OpenAICompatibleClient } from "../src/llm/openai-compatible-client.js";
import {
  buildProviderAdapterReadiness,
  type ProviderAdapterConfig,
} from "../src/llm/provider-adapter.js";
import type { LlmClient } from "../src/llm/client.js";
import {
  runCandidatePipeline,
  type CandidatePipelineResult,
} from "../src/orchestrator/candidate-pipeline.js";
import { loadDataset } from "../src/runtime/dataset-loader.js";
import { loadConfig, type HireLoopConfig } from "../src/config.js";
import {
  buildRuntimeDashboardSnapshot,
  DEFAULT_RUNTIME_SNAPSHOT_PATH,
  writeRuntimeDashboardSnapshot,
} from "../src/server/runtime-dashboard.js";
import { runPlan, type RunResult } from "../src/base/lark-cli-runner.js";
import type { PlanResult, BaseCommandSpec } from "../src/base/commands.js";
import { WORK_EVENT_TABLE } from "../src/base/schema.js";
import { containsSensitivePattern } from "../src/server/redaction.js";

// ── Types ──

export interface RunnerDependencies {
  deterministicClient?: LlmClient;
  providerClientFactory?: (config: ProviderAdapterConfig) => LlmClient;
  loadConfig?: () => HireLoopConfig;
  runPlan?: (options: { plan: PlanResult; config: HireLoopConfig; execute: boolean }) => RunResult;
}

export interface DatasetRunnerOptions {
  inputFile?: string;
  inputJson?: string;
  snapshotPath?: string;
  useProvider: boolean;
  executeModel: boolean;
  modelConfirm?: string;
  writeBase: boolean;
  writeConfirm?: string;
  inputRecordIdsAreLive: boolean;
  deps?: RunnerDependencies;
}

export interface DatasetRunnerResult {
  mode: string;
  totalCandidates: number;
  completedCount: number;
  failedCount: number;
  totalCommands: number;
  snapshotPath: string;
  writeAttempted: boolean;
  writeBlocked: boolean;
  writeBlockedReasons: string[];
  writeSucceededCount: number;
  writeFailedCount: number;
  workEventBlockedReasons: string[];
  safeSummary: string;
}

interface CliOptions {
  inputFile?: string;
  inputJson?: string;
  snapshotPath?: string;
  useProvider: boolean;
  executeModel: boolean;
  modelConfirm?: string;
  writeBase: boolean;
  writeConfirm?: string;
  inputRecordIdsAreLive: boolean;
}

const PROVIDER_DATASET_CONFIRM = "EXECUTE_PROVIDER_DATASET_AGENTS";
const WRITE_BASE_CONFIRM = "EXECUTE_LIVE_DATASET_WRITES";
const BASE_TOKEN_PLACEHOLDER = "<BASE_APP_TOKEN>";

// ── CLI arg parsing ──

function parseArgs(args: string[]): CliOptions {
  return {
    inputFile: args.find((arg) => arg.startsWith("--input-file="))?.slice("--input-file=".length),
    inputJson: args.find((arg) => arg.startsWith("--input-json="))?.slice("--input-json=".length),
    snapshotPath: args.find((arg) => arg.startsWith("--snapshot-path="))?.slice("--snapshot-path=".length),
    useProvider: args.includes("--use-provider"),
    executeModel: args.includes("--execute-model"),
    modelConfirm: args.find((arg) => arg.startsWith("--confirm="))?.slice("--confirm=".length),
    writeBase: args.includes("--write-base"),
    writeConfirm: args.find((arg) => arg.startsWith("--write-confirm="))?.slice("--write-confirm=".length),
    inputRecordIdsAreLive: args.includes("--input-record-ids-are-live"),
  };
}

// ── Helpers ──

type RunMode = "deterministic" | "provider" | "blocked";

function safeOut(text: string): string {
  return containsSensitivePattern(text) ? "[已脱敏]" : text;
}

function buildBlockedSummary(reasons: string[]): string {
  return `blocked: ${reasons.join("; ")}`;
}

function buildProviderConfig(config: HireLoopConfig): ProviderAdapterConfig {
  return {
    enabled: true,
    providerName: config.modelProvider,
    endpoint: config.modelApiEndpoint,
    modelId: config.modelId,
    apiKey: config.modelApiKey,
  };
}

function checkWorkEventsSchemaBlocked(): string[] {
  const reasons: string[] = [];
  const eventIdField = WORK_EVENT_TABLE.fields.find((f) => f.name === "event_id");
  if (eventIdField && eventIdField.required) {
    reasons.push(
      "Work Events table has a required identifier field that is forbidden in safe output. " +
      "Work Events writes are blocked until schema is adjusted to make this field optional or auto-generated.",
    );
  }
  return reasons;
}

/**
 * Build a safe Work Event record containing ONLY allowed fields.
 * Both args and redactedArgs use this same record — no event_id / link_status injection.
 */
export function buildSafeWorkEventRecord(
  index: number,
  result: CandidatePipelineResult,
  mode: string,
): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    agent_name: "analytics",
    event_type: "tool_call",
    tool_type: "none",
    target_table: null,
    execution_mode: mode,
    guard_status: "passed",
    safe_summary:
      `Candidate ${index + 1}: ${result.completed ? "completed" : "stopped at " + (result.failedAgent ?? "unknown")}. Status: ${result.finalStatus}.`,
    status_before: null,
    status_after: result.finalStatus,
    duration_ms: 0,
    created_at: now,
  };
}

export function buildWorkEventCommandSpec(
  index: number,
  result: CandidatePipelineResult,
  mode: string,
): BaseCommandSpec {
  const safeRecord = buildSafeWorkEventRecord(index, result, mode);
  const safeJson = JSON.stringify(safeRecord);

  // args and redactedArgs use the SAME safe record — no injection
  return {
    description: `Write Work Event for candidate ${index + 1}`,
    command: "lark-cli",
    args: [
      "base",
      "+record-upsert",
      "--base-token",
      BASE_TOKEN_PLACEHOLDER,
      "--table-id",
      "Work Events",
      "--json",
      safeJson,
    ],
    redactedArgs: [
      "base",
      "+record-upsert",
      "--base-token",
      BASE_TOKEN_PLACEHOLDER,
      "--table-id",
      "Work Events",
      "--json",
      safeJson,
    ],
    needsBaseToken: true,
    writesRemote: true,
  };
}

// ── Quiet console wrapper ──

function quietConsole<T>(fn: () => T): { result: T; capturedError: string[]; capturedLog: string[] } {
  const capturedError: string[] = [];
  const capturedLog: string[] = [];
  const origError = console.error;
  const origLog = console.log;

  console.error = (...args: unknown[]) => {
    capturedError.push(args.map(String).join(" "));
  };
  console.log = (...args: unknown[]) => {
    capturedLog.push(args.map(String).join(" "));
  };

  try {
    const result = fn();
    return { result, capturedError, capturedLog };
  } finally {
    console.error = origError;
    console.log = origLog;
  }
}

// ── Core runner (injectable) ──

export async function runLiveAgentDataset(options: DatasetRunnerOptions): Promise<DatasetRunnerResult> {
  const deps = options.deps ?? {};
  const loadConfigFn = deps.loadConfig ?? loadConfig;

  const dataset = loadDataset({
    inputFile: options.inputFile,
    inputJson: options.inputJson,
  });

  // --- Provider readiness check ---
  const config = loadConfigFn();
  const providerConfig = buildProviderConfig(config);
  const readiness = buildProviderAdapterReadiness(providerConfig);

  let runMode: RunMode = "deterministic";
  let client: LlmClient;

  if (options.useProvider) {
    const blockedReasons: string[] = [];

    if (!options.executeModel) {
      blockedReasons.push("--execute-model is required for provider mode");
    }
    if (options.modelConfirm !== PROVIDER_DATASET_CONFIRM) {
      blockedReasons.push(`--confirm=${PROVIDER_DATASET_CONFIRM} is required for provider mode`);
    }
    // Skip env readiness when using a controlled mock client factory
    if (!deps.providerClientFactory && readiness.status !== "ready") {
      blockedReasons.push(`Provider not ready: ${readiness.blockedReasons.join(", ")}`);
    }

    if (blockedReasons.length > 0) {
      return {
        mode: "provider_blocked",
        totalCandidates: dataset.inputs.length,
        completedCount: 0,
        failedCount: 0,
        totalCommands: 0,
        snapshotPath: options.snapshotPath || DEFAULT_RUNTIME_SNAPSHOT_PATH,
        writeAttempted: false,
        writeBlocked: false,
        writeBlockedReasons: [],
        writeSucceededCount: 0,
        writeFailedCount: 0,
        workEventBlockedReasons: [],
        safeSummary: buildBlockedSummary(blockedReasons),
      };
    }

    runMode = "provider";
    client = deps.providerClientFactory
      ? deps.providerClientFactory(providerConfig)
      : new OpenAICompatibleClient({ config: providerConfig });
  } else {
    client = deps.deterministicClient ?? new DeterministicLlmClient();
  }

  // --- Run pipelines (once per input) ---
  const pipelineResults: CandidatePipelineResult[] = [];
  const allCommands: BaseCommandSpec[] = [];

  for (let i = 0; i < dataset.inputs.length; i++) {
    const input = dataset.inputs[i]!;
    const result = await runCandidatePipeline(client, input);
    pipelineResults.push(result);
    allCommands.push(...result.commands);
  }

  // --- Build snapshot from last already-executed result (no re-run) ---
  const snapshotSource = runMode === "provider" ? "provider" as const : "deterministic" as const;
  const snapshotPath = options.snapshotPath || DEFAULT_RUNTIME_SNAPSHOT_PATH;

  const lastPipelineResult = pipelineResults[pipelineResults.length - 1]!;
  const snapshot = buildRuntimeDashboardSnapshot(lastPipelineResult, {
    source: snapshotSource,
    externalModelCalls: runMode === "provider",
  });
  writeRuntimeDashboardSnapshot(snapshot, snapshotPath);

  // --- Work Events schema check ---
  const workEventBlockedReasons = checkWorkEventsSchemaBlocked();

  // --- Write-base execution ---
  let writeAttempted = false;
  let writeBlocked = false;
  const writeBlockedReasons: string[] = [];
  let writeSucceededCount = 0;
  let writeFailedCount = 0;

  if (options.writeBase) {
    writeAttempted = true;

    if (!options.inputRecordIdsAreLive) {
      writeBlockedReasons.push(
        "--input-record-ids-are-live is required: caller must confirm that input candidateRecordId/jobRecordId are real Lark Base record IDs",
      );
    }
    if (options.writeConfirm !== WRITE_BASE_CONFIRM) {
      writeBlockedReasons.push(`--write-confirm=${WRITE_BASE_CONFIRM} is required`);
    }
    if (!config.allowLarkWrite) {
      writeBlockedReasons.push("HIRELOOP_ALLOW_LARK_WRITE=1 is required");
    }

    if (writeBlockedReasons.length > 0) {
      writeBlocked = true;
    } else {
      // Build command plan: agent commands + Work Events (if schema allows)
      const planCommands = [...allCommands];

      if (workEventBlockedReasons.length === 0) {
        const mode = runMode === "provider" ? "live_write" : "dry_run";
        for (let i = 0; i < pipelineResults.length; i++) {
          planCommands.push(buildWorkEventCommandSpec(i, pipelineResults[i]!, mode));
        }
      }

      const plan: PlanResult = {
        commands: planCommands,
        unsupportedFields: [],
      };

      const runPlanFn = deps.runPlan ?? runPlan;

      // Suppress console during runPlan — never leak internal output
      const { result: writeResult } = quietConsole(() =>
        runPlanFn({ plan, config, execute: true }),
      );

      writeBlocked = writeResult.blocked;

      // If blocked without guard reasons, add a generic safe reason
      if (writeResult.blocked && writeBlockedReasons.length === 0) {
        writeBlockedReasons.push("Base execution runner blocked the write plan.");
      }

      for (const r of writeResult.results) {
        if (r.status === "success") {
          writeSucceededCount++;
        } else if (r.status === "failed") {
          writeFailedCount++;
        }
      }
    }
  }

  // --- Build result ---
  const completedCount = pipelineResults.filter((r) => r.completed).length;
  const failedCount = pipelineResults.filter((r) => !r.completed).length;

  return {
    mode: runMode,
    totalCandidates: dataset.inputs.length,
    completedCount,
    failedCount,
    totalCommands: allCommands.length,
    snapshotPath,
    writeAttempted,
    writeBlocked,
    writeBlockedReasons,
    writeSucceededCount,
    writeFailedCount,
    workEventBlockedReasons,
    safeSummary: `Processed ${dataset.inputs.length} candidates: ${completedCount} completed, ${failedCount} stopped.`,
  };
}

// ── CLI entry point ──

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  // Load dataset first for early validation
  const dataset = loadDataset({
    inputFile: options.inputFile,
    inputJson: options.inputJson,
  });

  console.error(`Dataset loaded: ${dataset.totalCount} entries, ${dataset.errorCount} errors, ${dataset.inputs.length} valid`);

  if (dataset.errors.length > 0) {
    for (const err of dataset.errors) {
      console.error(`  Warning: ${safeOut(err)}`);
    }
  }

  const result = await runLiveAgentDataset(options);

  // Provider blocked: exit non-zero
  if (result.mode === "provider_blocked") {
    console.error(JSON.stringify({
      status: "blocked",
      mode: result.mode,
      safeSummary: result.safeSummary,
    }));
    process.exitCode = 1;
    return;
  }

  // Write-base guard blocked: log reasons
  if (result.writeAttempted && result.writeBlocked && result.writeBlockedReasons.length > 0) {
    console.error(JSON.stringify({
      status: "blocked",
      phase: "write_base",
      safeSummary: buildBlockedSummary(result.writeBlockedReasons),
    }));
  }

  // Work Events blocked: log reasons
  if (result.workEventBlockedReasons.length > 0) {
    console.error(JSON.stringify({
      status: "blocked",
      phase: "work_events",
      safeSummary: buildBlockedSummary(result.workEventBlockedReasons),
    }));
  }

  // Safe output — only summary fields
  console.error(JSON.stringify({
    mode: result.mode,
    totalCandidates: result.totalCandidates,
    completedCount: result.completedCount,
    failedCount: result.failedCount,
    totalCommands: result.totalCommands,
    writeAttempted: result.writeAttempted,
    writeBlocked: result.writeBlocked,
    writeSucceededCount: result.writeSucceededCount,
    writeFailedCount: result.writeFailedCount,
    workEventsBlocked: result.workEventBlockedReasons.length > 0,
    safeSummary: result.safeSummary,
  }));
}

function isMainModule(): boolean {
  const execPath = (process.argv[1] ?? "").replace(/\\/g, "/");
  return execPath.endsWith("/scripts/run-live-agent-dataset.ts") ||
         execPath.endsWith("/scripts/run-live-agent-dataset.js");
}

if (isMainModule()) {
  main().catch(() => {
    process.exitCode = 1;
    console.error(JSON.stringify({
      status: "failed",
      safeSummary: "Dataset runner failed before producing a safe result.",
    }));
  });
}
