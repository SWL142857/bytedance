import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { DeterministicLlmClient } from "../llm/deterministic-client.js";
import { runCandidatePipeline, type CandidatePipelineInput } from "./candidate-pipeline.js";
import { injectBaseToken, type BaseCommandSpec } from "../base/commands.js";
import { ALL_TABLES } from "../base/schema.js";
import { loadConfig, validateExecutionConfig, redactConfig } from "../config.js";
import type { CandidateStatus } from "../types/state.js";
import { readLiveCandidateContext } from "./live-candidate-context.js";

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

import type { LiveCandidateDeps } from "./live-candidate-context.js";
export type LiveCandidateWriteRunnerDeps = LiveCandidateDeps;

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

// ── Shared: read candidate + job from Feishu, run pipeline ──

async function runPipelineForCandidate(
  linkId: string,
  deps?: LiveCandidateWriteRunnerDeps,
): Promise<
  | { status: "blocked"; plan: SafeLiveCandidateWritePlan }
  | { status: "ok"; commands: BaseCommandSpec[]; planNonce: string; candidateDisplayName: string }
> {
  const ctx = await readLiveCandidateContext(linkId, { requireJob: true, deps });

  if (ctx.status === "blocked") {
    return { status: "blocked", plan: buildBlockedPlan(ctx.safeSummary) };
  }

  const {
    entry, candidateRecordId, jobRecordId, candidateId, jobId,
    resumeText, jobRequirements, jobRubric, candidateDisplayName,
  } = ctx.context;

  // Run deterministic pipeline
  const input: CandidatePipelineInput = {
    candidateRecordId,
    jobRecordId: jobRecordId!,
    candidateId,
    jobId: jobId!,
    resumeText,
    jobRequirements: jobRequirements!,
    jobRubric: jobRubric!,
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
