import { DeterministicLlmClient } from "../llm/deterministic-client.js";
import { runCandidatePipeline, type CandidatePipelineInput } from "./candidate-pipeline.js";
import {
  buildRuntimeDashboardSnapshot,
  writeRuntimeDashboardSnapshot,
} from "../server/runtime-dashboard.js";
import { getLiveLinkRegistry } from "../server/live-link-registry.js";
import { getLiveBaseStatus } from "../server/live-base.js";
import { buildListRecordsCommand } from "../base/queries.js";
import { runReadOnlyCommands, type CommandExecutor } from "../base/read-only-runner.js";
import { parseRecordList } from "../base/lark-cli-runner.js";
import type { HireLoopConfig } from "../config.js";
import { loadConfig } from "../config.js";

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

export interface LiveCandidateRunnerDeps {
  loadConfig?: () => HireLoopConfig;
  executor?: CommandExecutor;
  cliAvailable?: () => boolean;
}

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

function quietConsole<T>(fn: () => T): T {
  const originalError = console.error;
  const originalLog = console.log;
  console.error = () => {};
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.error = originalError;
    console.log = originalLog;
  }
}

// ── Main ──

export async function runLiveCandidateDryRun(
  linkId: string,
  deps?: LiveCandidateRunnerDeps,
): Promise<SafeLiveDryRunResult> {
  const configFn = deps?.loadConfig ?? loadConfig;
  const executor = deps?.executor;

  // 1. Validate linkId
  const entry = getLiveLinkRegistry().resolve(linkId);
  if (!entry) {
    return safeBlocked("未找到对应的飞书记录链接。");
  }
  if (entry.table !== "candidates") {
    return safeBlocked("当前仅支持对候选人记录运行 Agent 预演。");
  }

  // 2. Check read-only status
  const config = configFn();
  const status = getLiveBaseStatus({
    loadConfig: configFn,
    cliAvailable: deps?.cliAvailable,
  });
  if (status.blockedReasons.length > 0) {
    return safeBlocked("飞书只读未就绪，无法运行 Agent 预演。");
  }

  // 3. Read candidate record
  const candidateCmd = buildListRecordsCommand("candidates");
  const candidateResult = quietConsole(() => runReadOnlyCommands({
    commands: [candidateCmd],
    config,
    execute: true,
    executor,
  }));

  if (candidateResult.blocked) {
    return safeBlocked("飞书只读被阻断，无法读取候选人记录。");
  }

  const candidateOutput = candidateResult.results[0];
  if (!candidateOutput || candidateOutput.status !== "success" || !candidateOutput.stdout) {
    return safeBlocked("无法读取飞书候选人数据。");
  }

  let candidateRecords: Array<{ id: string; fields: Record<string, unknown> }>;
  try {
    candidateRecords = parseRecordList(candidateOutput.stdout).records;
  } catch {
    return safeBlocked("飞书候选人数据解析失败。");
  }

  const candidate = candidateRecords.find((r) => r.id === entry.recordId);
  if (!candidate) {
    return safeBlocked("未在飞书中找到对应候选人。");
  }

  const fields = candidate.fields;

  // 4. Extract candidate fields
  const candidateId = extractTextField(fields, "candidate_id") ?? `cand_live_${entry.recordId.slice(0, 8)}`;
  const resumeText = extractTextField(fields, "resume_text");
  const jobDisplay = extractTextField(fields, "job");
  const linkedJobRecordId = extractLinkRecordId(fields, "job");

  if (!resumeText) {
    return safeBlocked("候选人缺少简历文本，无法运行 Agent 预演。");
  }

  // 5. Read jobs to find the linked job
  let jobRecordId = "rec_job_unknown";
  let jobId = "job_unknown";
  let jobRequirements = "";
  let jobRubric = "";

  if (linkedJobRecordId || jobDisplay) {
    const jobsCmd = buildListRecordsCommand("jobs");
    const jobsResult = quietConsole(() => runReadOnlyCommands({
      commands: [jobsCmd],
      config,
      execute: true,
      executor,
    }));

    if (!jobsResult.blocked) {
      const jobsOutput = jobsResult.results[0];
      if (jobsOutput && jobsOutput.status === "success" && jobsOutput.stdout) {
        try {
          const jobsRecords = parseRecordList(jobsOutput.stdout).records;
          const matched = jobsRecords.find((j) => {
            if (linkedJobRecordId && j.id === linkedJobRecordId) return true;
            const title = extractTextField(j.fields, "title");
            return title === jobDisplay;
          });
          if (matched) {
            jobRecordId = matched.id;
            jobId = extractTextField(matched.fields, "job_id") ?? "job_live";
            jobRequirements = extractTextField(matched.fields, "requirements") ?? "";
            jobRubric = extractTextField(matched.fields, "rubric") ?? "";
          }
        } catch {
          // Continue with fallback job info
        }
      }
    }
  }

  if (!jobRequirements || !jobRubric) {
    return safeBlocked("无法获取岗位要求或评分标准，无法运行 Agent 预演。");
  }

  // 6. Run deterministic pipeline
  const input: CandidatePipelineInput = {
    candidateRecordId: entry.recordId,
    jobRecordId,
    candidateId,
    jobId,
    resumeText,
    jobRequirements,
    jobRubric,
  };

  try {
    const client = new DeterministicLlmClient();
    const result = await runCandidatePipeline(client, input);

    // 7. Write runtime snapshot
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

function extractTextField(fields: Record<string, unknown>, fieldName: string): string | null {
  const val = fields[fieldName];
  if (typeof val === "string" && val.length > 0) return val;
  if (Array.isArray(val) && val.length > 0) {
    const first = val[0];
    if (typeof first === "string") return first;
    if (typeof first === "object" && first !== null) {
      const obj = first as Record<string, unknown>;
      return typeof obj.text === "string" ? obj.text : null;
    }
  }
  return null;
}

function extractLinkRecordId(fields: Record<string, unknown>, fieldName: string): string | null {
  const val = fields[fieldName];
  if (!Array.isArray(val) || val.length === 0) return null;
  const first = val[0];
  if (typeof first !== "object" || first === null) return null;
  const obj = first as Record<string, unknown>;
  return typeof obj.id === "string" && obj.id.startsWith("rec") ? obj.id : null;
}
