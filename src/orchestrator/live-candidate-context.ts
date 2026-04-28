import { getLiveLinkRegistry, type LiveLinkEntry } from "../server/live-link-registry.js";
import { getLiveBaseStatus } from "../server/live-base.js";
import { buildListRecordsCommand } from "../base/queries.js";
import { runReadOnlyCommands, type CommandExecutor } from "../base/read-only-runner.js";
import { parseRecordList } from "../base/lark-cli-runner.js";
import type { HireLoopConfig } from "../config.js";
import { loadConfig } from "../config.js";

// ── Types ──

export interface LiveCandidateDeps {
  loadConfig?: () => HireLoopConfig;
  executor?: CommandExecutor;
  cliAvailable?: () => boolean;
}

export interface ReadLiveCandidateContextOptions {
  requireJob?: boolean;
  deps?: LiveCandidateDeps;
}

export interface LiveCandidateContext {
  linkId: string;
  entry: LiveLinkEntry;
  config: HireLoopConfig;
  candidateRecordId: string;
  candidateId: string;
  candidateDisplayName: string;
  resumeText: string;
  jobRecordId: string | null;
  jobId: string | null;
  jobRequirements: string | null;
  jobRubric: string | null;
  jobDisplayName: string | null;
}

export interface LiveCandidateContextOk {
  status: "ok";
  context: LiveCandidateContext;
}

export interface LiveCandidateContextBlocked {
  status: "blocked";
  safeSummary: string;
  blockedReasons: string[];
}

export type LiveCandidateContextResult = LiveCandidateContextOk | LiveCandidateContextBlocked;

// ── Internal helpers ──

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

function blocked(reason: string): LiveCandidateContextBlocked {
  return { status: "blocked", safeSummary: reason, blockedReasons: [reason] };
}

// ── Main ──

export async function readLiveCandidateContext(
  linkId: string,
  options?: ReadLiveCandidateContextOptions,
): Promise<LiveCandidateContextResult> {
  const requireJob = options?.requireJob ?? true;
  const deps = options?.deps;
  const configFn = deps?.loadConfig ?? loadConfig;
  const executor = deps?.executor;

  // 1. Validate linkId
  const entry = getLiveLinkRegistry().resolve(linkId);
  if (!entry) {
    return blocked("未找到对应的飞书记录链接。");
  }
  if (entry.table !== "candidates") {
    return blocked("当前仅支持对候选人记录执行操作。");
  }

  // 2. Check Base status
  const config = configFn();
  const baseStatus = getLiveBaseStatus({
    loadConfig: configFn,
    cliAvailable: deps?.cliAvailable,
  });
  if (baseStatus.blockedReasons.length > 0) {
    return blocked("飞书只读未就绪，无法读取候选人数据。");
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
    return blocked("飞书只读被阻断，无法读取候选人记录。");
  }

  const candidateOutput = candidateResult.results[0];
  if (!candidateOutput || candidateOutput.status !== "success" || !candidateOutput.stdout) {
    return blocked("无法读取飞书候选人数据。");
  }

  let candidateRecords: Array<{ id: string; fields: Record<string, unknown> }>;
  try {
    candidateRecords = parseRecordList(candidateOutput.stdout).records;
  } catch {
    return blocked("飞书候选人数据解析失败。");
  }

  const candidate = candidateRecords.find((r) => r.id === entry.recordId);
  if (!candidate) {
    return blocked("未在飞书中找到对应候选人。");
  }

  const fields = candidate.fields;

  // 4. Extract candidate fields
  const candidateRecordId = entry.recordId;
  const candidateId = extractTextField(fields, "candidate_id") ?? `cand_live_${candidateRecordId.slice(0, 8)}`;
  const candidateDisplayName = extractTextField(fields, "display_name") ?? "未知候选人";
  const resumeText = extractTextField(fields, "resume_text");
  const jobDisplay = extractTextField(fields, "job");
  const linkedJobRecordId = extractLinkRecordId(fields, "job");

  if (!resumeText) {
    return blocked("候选人缺少简历文本，无法继续操作。");
  }

  // 5. Read job
  let jobRecordId: string | null = null;
  let jobId: string | null = null;
  let jobRequirements: string | null = null;
  let jobRubric: string | null = null;
  let jobDisplayName: string | null = jobDisplay;

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
            jobDisplayName = extractTextField(matched.fields, "title") ?? jobDisplay;
          }
        } catch {
          // Continue with null job fields (non-blocking when requireJob: false)
        }
      }
    }
  }

  // 6. Check job requirements if required
  if (requireJob && (!jobRequirements || !jobRubric)) {
    return blocked("无法获取岗位要求或评分标准。");
  }

  return {
    status: "ok",
    context: {
      linkId,
      entry,
      config,
      candidateRecordId,
      candidateId,
      candidateDisplayName,
      resumeText,
      jobRecordId,
      jobId,
      jobRequirements,
      jobRubric,
      jobDisplayName,
    },
  };
}
