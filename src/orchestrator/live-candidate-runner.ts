import { DeterministicLlmClient } from "../llm/deterministic-client.js";
import { runCandidatePipeline, type CandidatePipelineInput } from "./candidate-pipeline.js";
import {
  buildRuntimeDashboardSnapshot,
  writeRuntimeDashboardSnapshot,
} from "../server/runtime-dashboard.js";
import { readLiveCandidateContext } from "./live-candidate-context.js";
import type { LiveCandidateDeps } from "./live-candidate-context.js";
import { loadConfig } from "../config.js";
import {
  runProviderAgentDemo,
  type ProviderAgentDemoResult,
} from "../llm/provider-agent-demo-runner.js";
import type { ResumeParserInput } from "../agents/resume-parser.js";

// ── Types ──

export interface SafeLiveDryRunResult {
  status: "success" | "blocked" | "failed";
  finalStatus: string | null;
  completed: boolean;
  failedAgent: string | null;
  agentRunCount: number;
  commandCount: number;
  snapshotUpdated: boolean;
  safeSummary: string;
  externalModelCalls: false;
  realWrites: false;
}

export type LiveCandidateRunnerDeps = LiveCandidateDeps;

// ── Safe summary helpers ──

const FIXED_ERROR_MSG = "Agent 预演运行失败，请稍后重试。";

function safeBlocked(reason: string): SafeLiveDryRunResult {
  return {
    status: "blocked",
    finalStatus: null,
    completed: false,
    failedAgent: null,
    agentRunCount: 0,
    commandCount: 0,
    snapshotUpdated: false,
    safeSummary: reason,
    externalModelCalls: false,
    realWrites: false,
  };
}

function safeSuccess(
  finalStatus: string,
  agentRunCount: number,
  commandCount: number,
  snapshotUpdated: boolean,
): SafeLiveDryRunResult {
  return {
    status: "success",
    finalStatus,
    completed: true,
    failedAgent: null,
    agentRunCount,
    commandCount,
    snapshotUpdated,
    safeSummary: `Agent 预演完成：状态推进到 ${finalStatus}，共 ${agentRunCount} 个 Agent 运行，${commandCount} 条命令。`,
    externalModelCalls: false,
    realWrites: false,
  };
}

// ── Main ──

export async function runLiveCandidateDryRun(
  linkId: string,
  deps?: LiveCandidateRunnerDeps,
): Promise<SafeLiveDryRunResult> {
  const ctx = await readLiveCandidateContext(linkId, { requireJob: true, deps });

  if (ctx.status === "blocked") {
    return safeBlocked(ctx.safeSummary);
  }

  const {
    candidateRecordId, jobRecordId, candidateId, jobId,
    resumeText, jobRequirements, jobRubric,
  } = ctx.context;

  // 1. Run deterministic pipeline
  const input: CandidatePipelineInput = {
    candidateRecordId,
    jobRecordId: jobRecordId!,
    candidateId,
    jobId: jobId!,
    resumeText: resumeText!,
    jobRequirements: jobRequirements!,
    jobRubric: jobRubric!,
  };

  try {
    const client = new DeterministicLlmClient();
    const result = await runCandidatePipeline(client, input);

    // 2. Write runtime snapshot
    let snapshotUpdated = false;
    try {
      const snapshot = buildRuntimeDashboardSnapshot(result, {
        source: "deterministic",
        externalModelCalls: false,
      });
      writeRuntimeDashboardSnapshot(snapshot);
      snapshotUpdated = true;
    } catch {
      // Snapshot write failure is non-fatal
    }

    if (result.failedAgent) {
      return {
        status: "failed",
        finalStatus: result.finalStatus,
        completed: result.completed,
        failedAgent: result.failedAgent,
        agentRunCount: result.agentRuns.length,
        commandCount: result.commands.length,
        snapshotUpdated,
        safeSummary: `Agent 预演未完成：${result.failedAgent} 阶段失败。`,
        externalModelCalls: false,
        realWrites: false,
      };
    }

    return safeSuccess(
      result.finalStatus,
      result.agentRuns.length,
      result.commands.length,
      snapshotUpdated,
    );
  } catch {
    return {
      status: "failed",
      finalStatus: null,
      completed: false,
      failedAgent: null,
      agentRunCount: 0,
      commandCount: 0,
      snapshotUpdated: false,
      safeSummary: FIXED_ERROR_MSG,
      externalModelCalls: false,
      realWrites: false,
    };
  }
}

// ── Phase 6.9: Provider Agent Demo ──

const PROVIDER_DEMO_CONFIRM = "EXECUTE_PROVIDER_AGENT_DEMO";

export interface LiveCandidateProviderAgentDemoOptions {
  confirm: string;
  deps?: LiveCandidateRunnerDeps;
}

export async function runLiveCandidateProviderAgentDemo(
  linkId: string,
  options: LiveCandidateProviderAgentDemoOptions,
): Promise<ProviderAgentDemoResult> {
  const deps = options.deps;
  const configFn = deps?.loadConfig ?? loadConfig;

  // 0. Check confirm phrase at execution boundary
  if (options.confirm !== PROVIDER_DEMO_CONFIRM) {
    return {
      mode: "execute",
      status: "blocked",
      providerName: configFn().modelProvider,
      canCallExternalModel: false,
      commandCount: null,
      agentRunStatus: null,
      retryCount: null,
      durationMs: 0,
      blockedReasons: ["确认短语错误，拒绝执行。"],
      safeSummary: "确认短语错误，拒绝执行。",
    };
  }

  // 1. Read candidate context (job not required for provider preview)
  const ctx = await readLiveCandidateContext(linkId, { requireJob: false, deps });

  if (ctx.status === "blocked") {
    return {
      mode: "execute",
      status: "blocked",
      providerName: configFn().modelProvider,
      canCallExternalModel: false,
      commandCount: null,
      agentRunStatus: null,
      retryCount: null,
      durationMs: 0,
      blockedReasons: ctx.blockedReasons,
      safeSummary: ctx.safeSummary,
    };
  }

  const { config, candidateRecordId, candidateId, resumeText } = ctx.context;

  // 2. Build provider adapter config and input
  const providerConfig = {
    enabled: true,
    providerName: config.modelProvider,
    endpoint: config.modelApiEndpoint,
    modelId: config.modelId,
    apiKey: config.modelApiKey,
  };

  const parserInput: ResumeParserInput = {
    candidateRecordId,
    candidateId,
    resumeText: resumeText!,
    fromStatus: "new",
  };

  // 3. Run provider agent demo
  try {
    const result = await runProviderAgentDemo(
      providerConfig,
      { useProvider: true, execute: true, confirm: options.confirm },
      undefined,
      parserInput,
    );
    return result;
  } catch {
    return {
      mode: "execute",
      status: "failed",
      providerName: config.modelProvider,
      canCallExternalModel: true,
      commandCount: null,
      agentRunStatus: null,
      retryCount: null,
      durationMs: 0,
      blockedReasons: [],
      safeSummary: "Provider Agent 预览运行失败，请稍后重试。",
    };
  }
}
