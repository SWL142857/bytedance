import {
  runLiveAgentDataset,
  type DatasetRunnerOptions,
  type DatasetRunnerResult,
} from "./run-live-agent-dataset.js";
import {
  buildProviderAdapterReadiness,
  type ProviderAdapterConfig,
} from "../src/llm/provider-adapter.js";
import { loadConfig, type HireLoopConfig } from "../src/config.js";

// ── Types ──

export interface VerifyDependencies {
  loadConfig?: () => HireLoopConfig;
  runLiveAgentDataset?: (opts: DatasetRunnerOptions) => Promise<DatasetRunnerResult>;
}

export interface VerifyOptions {
  inputFile?: string;
  inputJson?: string;
  snapshotPath?: string;
  executeProvider: boolean;
  confirm?: string;
  deps?: VerifyDependencies;
}

export interface VerifyResult {
  status: "passed" | "blocked" | "failed";
  mode: string;
  totalCandidates: number;
  completedCount: number;
  failedCount: number;
  totalCommands: number;
  snapshotWritten: boolean;
  externalModelCalls: boolean;
  safeSummary: string;
}

interface CliOptions {
  inputFile?: string;
  inputJson?: string;
  snapshotPath?: string;
  executeProvider: boolean;
  confirm?: string;
}

const REQUIRED_CONFIRM = "VERIFY_PROVIDER_DATASET_EXECUTE";

// ── Helpers ──

function parseArgs(args: string[]): CliOptions {
  return {
    inputFile: args.find((a) => a.startsWith("--input-file="))?.slice("--input-file=".length),
    inputJson: args.find((a) => a.startsWith("--input-json="))?.slice("--input-json=".length),
    snapshotPath: args.find((a) => a.startsWith("--snapshot-path="))?.slice("--snapshot-path=".length),
    executeProvider: args.includes("--execute-provider"),
    confirm: args.find((a) => a.startsWith("--confirm="))?.slice("--confirm=".length),
  };
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

function blockedResult(reason: string): VerifyResult {
  return {
    status: "blocked",
    mode: "provider_blocked",
    totalCandidates: 0,
    completedCount: 0,
    failedCount: 0,
    totalCommands: 0,
    snapshotWritten: false,
    externalModelCalls: false,
    safeSummary: reason,
  };
}

function failedResult(): VerifyResult {
  return {
    status: "failed",
    mode: "provider",
    totalCandidates: 0,
    completedCount: 0,
    failedCount: 0,
    totalCommands: 0,
    snapshotWritten: false,
    externalModelCalls: false,
    safeSummary: "Provider dataset verification failed before producing a safe result.",
  };
}

function fromRunnerResult(r: DatasetRunnerResult): VerifyResult {
  if (r.mode === "provider_blocked") {
    return {
      status: "blocked",
      mode: r.mode,
      totalCandidates: r.totalCandidates,
      completedCount: r.completedCount,
      failedCount: r.failedCount,
      totalCommands: r.totalCommands,
      snapshotWritten: false,
      externalModelCalls: false,
      safeSummary: "Provider dataset runner blocked provider execution.",
    };
  }

  if (r.mode !== "provider") {
    return {
      status: "failed",
      mode: r.mode,
      totalCandidates: r.totalCandidates,
      completedCount: r.completedCount,
      failedCount: r.failedCount,
      totalCommands: r.totalCommands,
      snapshotWritten: false,
      externalModelCalls: false,
      safeSummary: "Provider dataset verification did not execute provider mode.",
    };
  }

  if (r.totalCandidates <= 0) {
    return {
      status: "failed",
      mode: r.mode,
      totalCandidates: r.totalCandidates,
      completedCount: r.completedCount,
      failedCount: r.failedCount,
      totalCommands: r.totalCommands,
      snapshotWritten: false,
      externalModelCalls: false,
      safeSummary: "Provider dataset verification did not complete all candidates.",
    };
  }

  const passed = r.completedCount === r.totalCandidates && r.failedCount === 0;
  return {
    status: passed ? "passed" : "failed",
    mode: r.mode,
    totalCandidates: r.totalCandidates,
    completedCount: r.completedCount,
    failedCount: r.failedCount,
    totalCommands: r.totalCommands,
    snapshotWritten: true,
    externalModelCalls: true,
    safeSummary: passed ? r.safeSummary : "Provider dataset verification did not complete all candidates.",
  };
}

// ── Core function (injectable) ──

export async function runProviderDatasetVerify(options: VerifyOptions): Promise<VerifyResult> {
  const deps = options.deps ?? {};
  const loadConfigFn = deps.loadConfig ?? loadConfig;
  const runnerFn = deps.runLiveAgentDataset ?? runLiveAgentDataset;

  // Guard 1: --execute-provider required
  if (!options.executeProvider) {
    return blockedResult("--execute-provider is required for provider dataset verification.");
  }

  // Guard 2: confirm required
  if (options.confirm !== REQUIRED_CONFIRM) {
    return blockedResult(
      `--confirm=${REQUIRED_CONFIRM} is required for provider dataset verification.`,
    );
  }

  // Guard 3: provider env presence
  const config = loadConfigFn();
  const providerConfig = buildProviderConfig(config);
  const readiness = buildProviderAdapterReadiness(providerConfig);

  if (readiness.status !== "ready") {
    return blockedResult(
      `Provider not ready: ${readiness.blockedReasons.join("; ")}`,
    );
  }

  // All guards passed — run dataset with provider mode
  try {
    const runnerResult = await runnerFn({
      inputFile: options.inputFile,
      inputJson: options.inputJson,
      snapshotPath: options.snapshotPath,
      useProvider: true,
      executeModel: true,
      modelConfirm: "EXECUTE_PROVIDER_DATASET_AGENTS",
      writeBase: false,
      inputRecordIdsAreLive: false,
    });

    return fromRunnerResult(runnerResult);
  } catch {
    return failedResult();
  }
}

// ── CLI entry point ──

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const result = await runProviderDatasetVerify(options);

  if (result.status === "blocked" || result.status === "failed") {
    process.exitCode = 1;
  }

  // Safe output — only the allowed fields
  console.error(JSON.stringify(result));
}

function isMainModule(): boolean {
  const execPath = (process.argv[1] ?? "").replace(/\\/g, "/");
  return (
    execPath.endsWith("/scripts/run-provider-dataset-verify.ts") ||
    execPath.endsWith("/scripts/run-provider-dataset-verify.js")
  );
}

if (isMainModule()) {
  main().catch(() => {
    process.exitCode = 1;
    console.error(JSON.stringify({
      status: "failed",
      mode: "provider",
      totalCandidates: 0,
      completedCount: 0,
      failedCount: 0,
      totalCommands: 0,
      snapshotWritten: false,
      externalModelCalls: false,
      safeSummary: "Provider dataset verification failed before producing a safe result.",
    }));
  });
}
