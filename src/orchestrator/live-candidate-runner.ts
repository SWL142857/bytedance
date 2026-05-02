import { DeterministicLlmClient } from "../llm/deterministic-client.js";
import { runCandidatePipeline, type CandidatePipelineInput } from "./candidate-pipeline.js";
import {
  buildRuntimeDashboardSnapshot,
  writeRuntimeDashboardSnapshot,
} from "../server/runtime-dashboard.js";
import { readLiveCandidateContext } from "./live-candidate-context.js";
import type { LiveCandidateDeps } from "./live-candidate-context.js";
import { loadConfig } from "../config.js";
import { OpenAICompatibleClient } from "../llm/openai-compatible-client.js";
import { buildProviderAdapterReadiness, mapProviderAdapterError } from "../llm/provider-adapter.js";
import type { ProviderAgentDemoResult } from "../llm/provider-agent-demo-runner.js";

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

export interface LiveCandidateProviderPipelinePreviewResult extends ProviderAgentDemoResult {
  finalStatus: string | null;
  completed: boolean;
  failedAgent: string | null;
  agentRunCount: number | null;
  snapshotUpdated: boolean;
  realWrites: false;
}

function providerBlockedResult(
  providerName: string,
  reasons: string[],
  safeSummary: string,
): LiveCandidateProviderPipelinePreviewResult {
  return {
    mode: "execute",
    status: "blocked",
    providerName,
    canCallExternalModel: false,
    commandCount: null,
    agentRunStatus: null,
    retryCount: null,
    durationMs: 0,
    blockedReasons: reasons,
    safeSummary,
    finalStatus: null,
    completed: false,
    failedAgent: null,
    agentRunCount: null,
    snapshotUpdated: false,
    realWrites: false,
  };
}

export async function runLiveCandidateProviderAgentDemo(
  linkId: string,
  options: LiveCandidateProviderAgentDemoOptions,
): Promise<LiveCandidateProviderPipelinePreviewResult> {
  const deps = options.deps;
  const configFn = deps?.loadConfig ?? loadConfig;
  const config = configFn();

  // 0. Check confirm phrase at execution boundary
  if (options.confirm !== PROVIDER_DEMO_CONFIRM) {
    return providerBlockedResult(
      config.modelProvider,
      ["确认短语错误，拒绝执行。"],
      "确认短语错误，拒绝执行。",
    );
  }

  // 1. Read candidate + job context. Full P3 provider preview needs both.
  const ctx = await readLiveCandidateContext(linkId, { requireJob: true, deps });

  if (ctx.status === "blocked") {
    return providerBlockedResult(config.modelProvider, ctx.blockedReasons, ctx.safeSummary);
  }

  // 2. Build provider adapter config and fail closed before any model call.
  const providerConfig = {
    enabled: true,
    providerName: config.modelProvider,
    endpoint: config.modelApiEndpoint,
    modelId: config.modelId,
    apiKey: config.modelApiKey,
  };

  const readiness = buildProviderAdapterReadiness(providerConfig);
  const blockedReasons = [...readiness.blockedReasons];
  if (!readiness.canCallExternalModel) {
    blockedReasons.unshift("Provider adapter is not ready.");
  }
  if (blockedReasons.length > 0) {
    return providerBlockedResult(
      config.modelProvider,
      blockedReasons,
      `Provider Pipeline 预览被阻断：请先补齐模型配置。`,
    );
  }

  const {
    candidateRecordId, jobRecordId, candidateId, jobId,
    resumeText, jobRequirements, jobRubric,
  } = ctx.context;

  const input: CandidatePipelineInput = {
    candidateRecordId,
    jobRecordId: jobRecordId!,
    candidateId,
    jobId: jobId!,
    resumeText: resumeText!,
    jobRequirements: jobRequirements!,
    jobRubric: jobRubric!,
  };

  // 3. Run full P3 pipeline with provider-backed LLM. Still no Feishu writes.
  const start = Date.now();
  try {
    const client = new OpenAICompatibleClient({ config: providerConfig });
    const result = await runCandidatePipeline(client, input);
    const durationMs = Date.now() - start;

    let snapshotUpdated = false;
    try {
      const snapshot = buildRuntimeDashboardSnapshot(result, {
        source: "provider",
        externalModelCalls: true,
      });
      writeRuntimeDashboardSnapshot(snapshot);
      snapshotUpdated = true;
    } catch {
      // Snapshot write failure should not expose provider details or fail the preview.
    }

    const completed = result.completed && !result.failedAgent;
    return {
      mode: "execute",
      status: completed ? "success" : "failed",
      providerName: config.modelProvider,
      canCallExternalModel: true,
      commandCount: result.commands.length,
      agentRunStatus: completed ? "success" : "failed",
      retryCount: Math.max(...result.agentRuns.map((run) => run.retry_count), 0),
      durationMs,
      blockedReasons: [],
      safeSummary: completed
        ? `Provider Pipeline 预览完成：${result.agentRuns.length} 个 Agent 运行，生成 ${result.commands.length} 条安全写入计划，未写入飞书。`
        : `Provider Pipeline 预览未完成：${result.failedAgent ?? "unknown_agent"} 阶段失败，未写入飞书。`,
      finalStatus: result.finalStatus,
      completed,
      failedAgent: result.failedAgent ?? null,
      agentRunCount: result.agentRuns.length,
      snapshotUpdated,
      realWrites: false,
    };
  } catch (err: unknown) {
    const mapped = mapProviderAdapterError(err);
    return {
      mode: "execute",
      status: "failed",
      providerName: config.modelProvider,
      canCallExternalModel: true,
      commandCount: null,
      agentRunStatus: null,
      retryCount: null,
      durationMs: Date.now() - start,
      blockedReasons: [],
      safeSummary: mapped.safeMessage,
      finalStatus: null,
      completed: false,
      failedAgent: null,
      agentRunCount: null,
      snapshotUpdated: false,
      realWrites: false,
    };
  }
}
