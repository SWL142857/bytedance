import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { DeterministicLlmClient } from "../llm/deterministic-client.js";
import { runCandidatePipeline, type CandidatePipelineInput } from "./candidate-pipeline.js";
import { getLiveLinkRegistry } from "../server/live-link-registry.js";
import { getLiveBaseStatus } from "../server/live-base.js";
import { buildListRecordsCommand } from "../base/queries.js";
import { runReadOnlyCommands, type CommandExecutor } from "../base/read-only-runner.js";
import { parseRecordList } from "../base/lark-cli-runner.js";
import { injectBaseToken, type BaseCommandSpec } from "../base/commands.js";
import { ALL_TABLES } from "../base/schema.js";
import type { HireLoopConfig } from "../config.js";
import { loadConfig, validateExecutionConfig, redactConfig } from "../config.js";
import type { CandidateStatus } from "../types/state.js";

// ── Types ──

export interface SafeWritePlanCommand {
  description: string;
  targetTable: string;
  action: "record_upsert" | "status_transition" | "unknown";
}

export interface SafeLiveCandidateWritePlan {
  status: "planned" | "blocked";
  planNonce: string;
  candidateDisplayName: string | null;
  commandCount: number;
  commands: SafeWritePlanCommand[];
  blockedReasons: string[];
  safeSummary: string;
}

export interface SafeLiveCandidateWriteResult {
  status: "success" | "blocked" | "failed";
  executed: boolean;
  planNonce: string;
  commandCount: number;
  successCount: number;
  failedCount: number;
  stoppedAtCommandIndex: number | null;
  safeSummary: string;
}

export interface LiveCandidateWriteRunnerDeps {
  loadConfig?: () => HireLoopConfig;
  executor?: CommandExecutor;
  cliAvailable?: () => boolean;
}

export interface ExecuteLiveCandidateWritesOptions {
  confirm: string;
  reviewConfirm: string;
  planNonce: string;
  deps?: LiveCandidateWriteRunnerDeps;
}

// ── Constants ──

export const LIVE_CANDIDATE_WRITE_CONFIRM = "EXECUTE_LIVE_CANDIDATE_WRITES";
export const REVIEWED_WRITE_PLAN_CONFIRM = "REVIEWED_DECISION_PENDING_WRITE_PLAN";
const ALLOWED_STATUSES_FOR_WRITE: CandidateStatus[] = [
  "new", "parsed", "screened", "interview_kit_ready", "decision_pending",
];
const VALID_WRITE_TABLES = new Set([
  "candidates", "agent_runs", "evaluations", "resume_facts", "interview_kits",
]);

// Build a reverse map: displayName → tableName
const DISPLAY_NAME_TO_TABLE: Map<string, string> = new Map();
for (const table of ALL_TABLES) {
  DISPLAY_NAME_TO_TABLE.set(table.name, table.tableName);
  DISPLAY_NAME_TO_TABLE.set(table.tableName, table.tableName);
}

// ── Helpers ──

function computePlanNonce(
  linkId: string,
  candidateRecordId: string,
  commands: BaseCommandSpec[],
): string {
  const parts: string[] = [linkId, candidateRecordId];
  for (const cmd of commands) {
    parts.push(cmd.command);
    // Include args with BASE_TOKEN placeholder preserved
    parts.push(cmd.args.join("\x00"));
  }
  const canonical = parts.join("\x01");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

function classifyCommandAction(cmd: BaseCommandSpec): SafeWritePlanCommand["action"] {
  const desc = cmd.description.toLowerCase();
  if (desc.includes("status") || desc.includes("->")) return "status_transition";
  if (desc.includes("upsert")) return "record_upsert";
  return "unknown";
}

function classifyTargetTable(cmd: BaseCommandSpec): string {
  const tableIdIdx = cmd.args.indexOf("--table-id");
  if (tableIdIdx >= 0 && tableIdIdx + 1 < cmd.args.length) {
    const displayName = cmd.args[tableIdIdx + 1]!;
    const tableName = DISPLAY_NAME_TO_TABLE.get(displayName);
    if (tableName && VALID_WRITE_TABLES.has(tableName)) {
      return tableName;
    }
    return tableName ?? "unknown";
  }
  return "unknown";
}

export function validateLiveCandidateWriteScope(commands: BaseCommandSpec[]): string[] {
  const blockedReasons: string[] = [];

  for (const cmd of commands) {
    if (!cmd.writesRemote) {
      blockedReasons.push(`Non-write command found in plan: ${cmd.description}`);
      continue;
    }

    const isAllowedUpsert =
      cmd.command === "lark-cli" &&
      cmd.args[0] === "base" &&
      cmd.args[1] === "+record-upsert";

    if (!isAllowedUpsert) {
      blockedReasons.push(`Disallowed write command in plan: ${cmd.description}`);
      continue;
    }

    // Block offer/rejected status writes
    const argsJoined = cmd.args.join(" ");
    for (const forbidden of ["offer", "rejected"]) {
      if (argsJoined.includes(`"${forbidden}"`)) {
        blockedReasons.push(
          `Plan contains ${forbidden} status write (blocked): ${cmd.description}`,
        );
      }
    }

    // Verify status transitions don't go past decision_pending
    if (cmd.description.includes("->")) {
      const toPart = cmd.description.split("->")[1]?.trim().split(" ")[0];
      if (toPart && !ALLOWED_STATUSES_FOR_WRITE.includes(toPart as CandidateStatus)) {
        blockedReasons.push(
          `Plan writes disallowed status "${toPart}": ${cmd.description}`,
        );
      }
    }

    const targetTable = classifyTargetTable(cmd);
    if (targetTable === "unknown") {
      blockedReasons.push(`Plan targets unknown table: ${cmd.description}`);
    } else if (!VALID_WRITE_TABLES.has(targetTable)) {
      blockedReasons.push(`Plan targets disallowed table "${targetTable}": ${cmd.description}`);
    }
  }

  return blockedReasons;
}

function buildBlockedPlan(reason: string): SafeLiveCandidateWritePlan {
  return {
    status: "blocked",
    planNonce: "",
    candidateDisplayName: null,
    commandCount: 0,
    commands: [],
    blockedReasons: [reason],
    safeSummary: reason,
  };
}

function buildBlockedResult(
  planNonce: string,
  reasons: string[],
): SafeLiveCandidateWriteResult {
  return {
    status: "blocked",
    executed: false,
    planNonce,
    commandCount: 0,
    successCount: 0,
    failedCount: 0,
    stoppedAtCommandIndex: null,
    safeSummary: reasons[0] ?? "写入执行被阻止。",
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

// ── Shared: read candidate + job from Feishu, run pipeline ──

async function runPipelineForCandidate(
  linkId: string,
  deps?: LiveCandidateWriteRunnerDeps,
): Promise<
  | { status: "blocked"; plan: SafeLiveCandidateWritePlan }
  | { status: "ok"; commands: BaseCommandSpec[]; planNonce: string; candidateDisplayName: string }
> {
  const configFn = deps?.loadConfig ?? loadConfig;
  const executor = deps?.executor;

  // 1. Validate linkId
  const entry = getLiveLinkRegistry().resolve(linkId);
  if (!entry) {
    return { status: "blocked", plan: buildBlockedPlan("未找到对应的飞书记录链接。") };
  }
  if (entry.table !== "candidates") {
    return { status: "blocked", plan: buildBlockedPlan("当前仅支持对候选人记录执行写入。") };
  }

  // 2. Check Base status
  const config = configFn();
  const baseStatus = getLiveBaseStatus({
    loadConfig: configFn,
    cliAvailable: deps?.cliAvailable,
  });
  if (baseStatus.blockedReasons.length > 0) {
    return { status: "blocked", plan: buildBlockedPlan("飞书只读未就绪，无法生成写入计划。") };
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
    return { status: "blocked", plan: buildBlockedPlan("飞书只读被阻断，无法读取候选人记录。") };
  }

  const candidateOutput = candidateResult.results[0];
  if (!candidateOutput || candidateOutput.status !== "success" || !candidateOutput.stdout) {
    return { status: "blocked", plan: buildBlockedPlan("无法读取飞书候选人数据。") };
  }

  let candidateRecords: Array<{ id: string; fields: Record<string, unknown> }>;
  try {
    candidateRecords = parseRecordList(candidateOutput.stdout).records;
  } catch {
    return { status: "blocked", plan: buildBlockedPlan("飞书候选人数据解析失败。") };
  }

  const candidate = candidateRecords.find((r) => r.id === entry.recordId);
  if (!candidate) {
    return { status: "blocked", plan: buildBlockedPlan("未在飞书中找到对应候选人。") };
  }

  const fields = candidate.fields;
  const candidateDisplayName = extractTextField(fields, "display_name") ?? "未知候选人";

  // 4. Extract candidate fields
  const candidateId = extractTextField(fields, "candidate_id") ?? `cand_live_${entry.recordId.slice(0, 8)}`;
  const resumeText = extractTextField(fields, "resume_text");
  const jobDisplay = extractTextField(fields, "job");
  const linkedJobRecordId = extractLinkRecordId(fields, "job");

  if (!resumeText) {
    return { status: "blocked", plan: buildBlockedPlan("候选人缺少简历文本，无法生成写入计划。") };
  }

  // 5. Read job
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
          // Continue with fallback
        }
      }
    }
  }

  if (!jobRequirements || !jobRubric) {
    return { status: "blocked", plan: buildBlockedPlan("无法获取岗位要求或评分标准。") };
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

  const client = new DeterministicLlmClient();
  const pipelineResult = await runCandidatePipeline(client, input);

  const planNonce = computePlanNonce(linkId, entry.recordId, pipelineResult.commands);

  return {
    status: "ok",
    commands: pipelineResult.commands,
    planNonce,
    candidateDisplayName,
  };
}

// ── Public API ──

export async function generateLiveCandidateWritePlan(
  linkId: string,
  deps?: LiveCandidateWriteRunnerDeps,
): Promise<SafeLiveCandidateWritePlan> {
  try {
    const result = await runPipelineForCandidate(linkId, deps);

    if (result.status === "blocked") {
      return result.plan;
    }

    const { commands, planNonce, candidateDisplayName } = result;

    // Validate write scope
    const scopeErrors = validateLiveCandidateWriteScope(commands);
    if (scopeErrors.length > 0) {
      return {
        status: "blocked",
        planNonce,
        candidateDisplayName,
        commandCount: commands.length,
        commands: [],
        blockedReasons: scopeErrors,
        safeSummary: `写入计划生成失败：${scopeErrors.length} 个命令未通过安全检查。`,
      };
    }

    const safeCommands: SafeWritePlanCommand[] = commands.map((cmd) => ({
      description: cmd.description,
      targetTable: classifyTargetTable(cmd),
      action: classifyCommandAction(cmd),
    }));

    // Verify pipeline didn't advance past decision_pending
    const statusCommandDescs = safeCommands
      .filter((c) => c.action === "status_transition")
      .map((c) => c.description);

    for (const desc of statusCommandDescs) {
      if (desc.includes("offer") || desc.includes("rejected")) {
        return {
          status: "blocked",
          planNonce,
          candidateDisplayName,
          commandCount: commands.length,
          commands: [],
          blockedReasons: ["Write plan contains offer/rejected status transition (blocked)."],
          safeSummary: "写入计划包含 offer/rejected 状态推进，已阻止。",
        };
      }
    }

    return {
      status: "planned",
      planNonce,
      candidateDisplayName,
      commandCount: safeCommands.length,
      commands: safeCommands,
      blockedReasons: [],
      safeSummary: `写入计划已生成：${safeCommands.length} 条命令，目标候选人 "${candidateDisplayName}"。`,
    };
  } catch {
    return buildBlockedPlan("写入计划生成失败，请稍后重试。");
  }
}

export async function executeLiveCandidateWrites(
  linkId: string,
  options: ExecuteLiveCandidateWritesOptions,
): Promise<SafeLiveCandidateWriteResult> {
  const deps = options.deps;
  const configFn = deps?.loadConfig ?? loadConfig;

  // 0. Check confirm phrases (double confirm)
  if (options.confirm !== LIVE_CANDIDATE_WRITE_CONFIRM) {
    return buildBlockedResult("", ["第一确认短语错误，拒绝执行。"]);
  }

  if (options.reviewConfirm !== REVIEWED_WRITE_PLAN_CONFIRM) {
    return buildBlockedResult("", ["第二确认短语错误：请审阅写入计划后使用 REVIEWED_DECISION_PENDING_WRITE_PLAN 确认。"]);
  }

  if (!options.planNonce || options.planNonce.trim().length === 0) {
    return buildBlockedResult("", ["缺少 planNonce，拒绝执行。"]);
  }

  // 1. Re-run pipeline to get fresh commands and recompute nonce
  let pipelineResult: Awaited<ReturnType<typeof runPipelineForCandidate>>;
  try {
    pipelineResult = await runPipelineForCandidate(linkId, deps);
  } catch {
    return {
      status: "failed",
      executed: false,
      planNonce: options.planNonce,
      commandCount: 0,
      successCount: 0,
      failedCount: 0,
      stoppedAtCommandIndex: null,
      safeSummary: "写入执行失败，请稍后重试。",
    };
  }

  if (pipelineResult.status === "blocked") {
    return {
      status: "blocked",
      executed: false,
      planNonce: options.planNonce,
      commandCount: 0,
      successCount: 0,
      failedCount: 0,
      stoppedAtCommandIndex: null,
      safeSummary: pipelineResult.plan.safeSummary,
    };
  }

  const { commands, planNonce: recomputedNonce } = pipelineResult;

  // 2. Verify planNonce matches (TOCTOU guard)
  if (recomputedNonce !== options.planNonce) {
    return buildBlockedResult(recomputedNonce, [
      "planNonce 不匹配：候选人数据可能已变更，请重新生成写入计划。",
    ]);
  }

  // 3. Validate write scope
  const scopeErrors = validateLiveCandidateWriteScope(commands);
  if (scopeErrors.length > 0) {
    return buildBlockedResult(recomputedNonce, scopeErrors);
  }

  // 4. Check write permission
  const config = configFn();
  const configErrors = validateExecutionConfig(config);
  if (configErrors.length > 0) {
    console.error("Live candidate write execution blocked due to invalid config:");
    for (const err of configErrors) {
      console.error(`  - ${err.field}: ${err.message}`);
    }
    console.error("Redacted config:", JSON.stringify(redactConfig(config), null, 2));
    return buildBlockedResult(recomputedNonce, configErrors.map((e) => `${e.field}: ${e.message}`));
  }

  // 5. Execute commands sequentially
  const results: Array<{ success: boolean; commandIndex: number }> = [];
  let stoppedAtIndex: number | null = null;

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i]!;
    const baseToken = config.baseAppToken;
    if (!baseToken) {
      stoppedAtIndex = i;
      break;
    }

    const { command, args } = injectBaseToken(cmd, baseToken);

    try {
      const result = spawnSync(command, args, {
        timeout: 30000,
        encoding: "utf-8",
      });
      const ok = (result.status ?? 1) === 0;
      results.push({ success: ok, commandIndex: i });
      if (!ok) {
        stoppedAtIndex = i + 1;
        break;
      }
    } catch {
      results.push({ success: false, commandIndex: i });
      stoppedAtIndex = i + 1;
      break;
    }
  }

  const successCount = results.filter((r) => r.success).length;
  const failedCount = results.filter((r) => !r.success).length;
  const allSucceeded = successCount === commands.length && failedCount === 0;

  return {
    status: allSucceeded ? "success" : "failed",
    executed: true,
    planNonce: recomputedNonce,
    commandCount: commands.length,
    successCount,
    failedCount,
    stoppedAtCommandIndex: stoppedAtIndex,
    safeSummary: allSucceeded
      ? `写入完成：${successCount}/${commands.length} 条命令成功执行。`
      : `写入未完成：${successCount} 成功，${failedCount} 失败` +
        (stoppedAtIndex ? `，在第 ${stoppedAtIndex} 条命令停止。` : "。"),
  };
}
