import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { injectBaseToken, type BaseCommandSpec } from "../base/commands.js";
import type { CommandResult } from "../base/read-only-runner.js";
import { loadConfig, validateExecutionConfig, redactConfig } from "../config.js";
import { readLiveCandidateContext, type LiveCandidateDeps } from "./live-candidate-context.js";
import { buildHumanDecisionPlan } from "./human-decision.js";

// ── Types ──

export interface SafeHumanDecisionPlanCommand {
  description: string;
  action: "record_upsert" | "status_transition";
}

export interface SafeLiveHumanDecisionPlan {
  status: "planned" | "blocked";
  planNonce: string;
  candidateDisplayName: string | null;
  commandCount: number;
  commands: SafeHumanDecisionPlanCommand[];
  decision: "offer" | "rejected" | null;
  blockedReasons: string[];
  safeSummary: string;
}

export interface SafeLiveHumanDecisionResult {
  status: "success" | "blocked" | "failed";
  executed: boolean;
  planNonce: string;
  commandCount: number;
  successCount: number;
  failedCount: number;
  stoppedAtCommandIndex: number | null;
  safeSummary: string;
}

export type LiveHumanDecisionRunnerDeps = LiveCandidateDeps;

export interface LiveHumanDecisionInput {
  decision: "offer" | "rejected";
  decidedBy: string;
  decisionNote: string;
}

export interface ExecuteLiveHumanDecisionOptions {
  confirm: string;
  reviewConfirm: string;
  planNonce: string;
  decision: LiveHumanDecisionInput["decision"];
  decidedBy: LiveHumanDecisionInput["decidedBy"];
  decisionNote: LiveHumanDecisionInput["decisionNote"];
  deps?: LiveHumanDecisionRunnerDeps;
}

// ── Constants ──

export const LIVE_HUMAN_DECISION_CONFIRM = "EXECUTE_LIVE_HUMAN_DECISION";
export const REVIEWED_HUMAN_DECISION_PLAN_CONFIRM = "REVIEWED_HUMAN_DECISION_PLAN";

const MAX_DECISION_NOTE_LENGTH = 500;
const FIXED_PLAN_FAILURE_MSG = "决策计划生成失败，请稍后重试。";
const FIXED_EXECUTION_FAILURE_MSG = "决策执行失败，请稍后重试。";
const CANDIDATE_STATUS_BLOCKED_MSG = "候选人当前不是 decision_pending 状态，拒绝执行人类最终决策。";

// ── Helpers ──

function computePlanNonce(
  linkId: string,
  candidateRecordId: string,
  input: LiveHumanDecisionInput,
  commands: BaseCommandSpec[],
): string {
  const parts: string[] = [
    linkId,
    candidateRecordId,
    input.decision,
    input.decidedBy,
    input.decisionNote,
  ];
  for (const cmd of commands) {
    parts.push(cmd.command);
    parts.push(cmd.args.join("\x00"));
  }
  const canonical = parts.join("\x01");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

function validateDecisionInput(input: LiveHumanDecisionInput): string[] {
  const reasons: string[] = [];
  if (input.decision !== "offer" && input.decision !== "rejected") {
    reasons.push("decision 必须是 offer 或 rejected。");
  }
  if (typeof input.decidedBy !== "string" || input.decidedBy.trim().length === 0) {
    reasons.push("decidedBy 不能为空。");
  }
  if (typeof input.decisionNote !== "string" || input.decisionNote.trim().length === 0) {
    reasons.push("decisionNote 不能为空。");
  } else if (input.decisionNote.length > MAX_DECISION_NOTE_LENGTH) {
    reasons.push(`decisionNote 不能超过 ${MAX_DECISION_NOTE_LENGTH} 个字符。`);
  }
  return reasons;
}

function classifyCommandAction(cmd: BaseCommandSpec): SafeHumanDecisionPlanCommand["action"] {
  const desc = cmd.description.toLowerCase();
  if (desc.includes("->")) return "status_transition";
  return "record_upsert";
}

function argValue(args: string[], name: string): string | null {
  const idx = args.indexOf(name);
  if (idx < 0 || idx + 1 >= args.length) return null;
  return args[idx + 1] ?? null;
}

function parseCommandPayload(cmd: BaseCommandSpec): Record<string, unknown> | null {
  const json = argValue(cmd.args, "--json");
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function hasOnlyFields(payload: Record<string, unknown>, allowed: string[]): boolean {
  const keys = Object.keys(payload).sort();
  const expected = [...allowed].sort();
  return keys.length === expected.length && keys.every((key, idx) => key === expected[idx]);
}

export function validateLiveHumanDecisionScope(
  commands: BaseCommandSpec[],
  candidateRecordId: string,
  decision: LiveHumanDecisionInput["decision"],
): string[] {
  const blockedReasons: string[] = [];
  let hasDecisionFieldsCommand = false;
  let hasStatusCommand = false;

  if (commands.length !== 2) {
    blockedReasons.push("人类决策计划命令数量异常。");
  }

  for (const cmd of commands) {
    const isCandidateUpsert =
      cmd.command === "lark-cli" &&
      cmd.args[0] === "base" &&
      cmd.args[1] === "+record-upsert" &&
      cmd.writesRemote === true &&
      cmd.needsBaseToken === true &&
      argValue(cmd.args, "--table-id") === "Candidates";

    if (!isCandidateUpsert) {
      blockedReasons.push("人类决策计划包含非候选人写入命令。");
      continue;
    }

    if (argValue(cmd.args, "--record-id") !== candidateRecordId) {
      blockedReasons.push("人类决策计划目标记录不匹配。");
      continue;
    }

    const payload = parseCommandPayload(cmd);
    if (!payload) {
      blockedReasons.push("人类决策计划包含无法解析的写入内容。");
      continue;
    }

    if ("human_decision" in payload) {
      hasDecisionFieldsCommand = true;
      if (!hasOnlyFields(payload, ["human_decision", "human_decision_by", "human_decision_note"])) {
        blockedReasons.push("人类决策字段写入范围异常。");
      }
      if (payload["human_decision"] !== decision) {
        blockedReasons.push("人类决策字段与本次决策不一致。");
      }
      continue;
    }

    if ("status" in payload) {
      hasStatusCommand = true;
      if (!hasOnlyFields(payload, ["status"])) {
        blockedReasons.push("人类决策状态写入范围异常。");
      }
      if (payload["status"] !== decision) {
        blockedReasons.push("人类决策状态与本次决策不一致。");
      }
      if (!cmd.description.includes(`decision_pending -> ${decision}`)) {
        blockedReasons.push("人类决策状态转换必须从 decision_pending 开始。");
      }
      if (!cmd.description.includes("human_confirm")) {
        blockedReasons.push("人类决策状态转换必须由 human_confirm 执行。");
      }
      continue;
    }

    blockedReasons.push("人类决策计划包含未知候选人字段写入。");
  }

  if (!hasDecisionFieldsCommand) {
    blockedReasons.push("人类决策计划缺少决策字段写入。");
  }
  if (!hasStatusCommand) {
    blockedReasons.push("人类决策计划缺少状态写入。");
  }

  return [...new Set(blockedReasons)];
}

function defaultWriteExecutor(command: string, args: string[]): CommandResult {
  const start = Date.now();
  const result = spawnSync(command, args, {
    timeout: 30000,
    encoding: "utf-8",
  });
  const durationMs = Date.now() - start;
  const exitCode = result.status ?? null;
  return {
    description: "",
    status: exitCode === 0 ? "success" : "failed",
    stdout: result.stdout ?? null,
    stderr: result.stderr ?? result.error?.message ?? null,
    exitCode,
    durationMs,
  };
}

function buildBlockedPlan(reason: string): SafeLiveHumanDecisionPlan {
  return {
    status: "blocked",
    planNonce: "",
    candidateDisplayName: null,
    commandCount: 0,
    commands: [],
    decision: null,
    blockedReasons: [reason],
    safeSummary: reason,
  };
}

function buildBlockedResult(
  planNonce: string,
  reasons: string[],
): SafeLiveHumanDecisionResult {
  return {
    status: "blocked",
    executed: false,
    planNonce,
    commandCount: 0,
    successCount: 0,
    failedCount: 0,
    stoppedAtCommandIndex: null,
    safeSummary: reasons[0] ?? "决策执行被阻止。",
  };
}

// ── Public API ──

export async function generateLiveHumanDecisionPlan(
  linkId: string,
  input: LiveHumanDecisionInput,
  deps?: LiveHumanDecisionRunnerDeps,
): Promise<SafeLiveHumanDecisionPlan> {
  const inputErrors = validateDecisionInput(input);
  if (inputErrors.length > 0) {
    return buildBlockedPlan(inputErrors[0]!);
  }

  try {
    const ctx = await readLiveCandidateContext(linkId, {
      requireJob: false,
      requireResume: false,
      deps,
    });

    if (ctx.status === "blocked") {
      return buildBlockedPlan(ctx.safeSummary);
    }

    const {
      entry,
      candidateRecordId,
      candidateId,
      candidateDisplayName,
      candidateStatus,
    } = ctx.context;

    if (candidateStatus !== "decision_pending") {
      return buildBlockedPlan(CANDIDATE_STATUS_BLOCKED_MSG);
    }

    const plan = buildHumanDecisionPlan({
      candidateRecordId,
      candidateId,
      decision: input.decision,
      decidedBy: input.decidedBy,
      decisionNote: input.decisionNote,
      fromStatus: "decision_pending",
    });

    const planNonce = computePlanNonce(linkId, entry.recordId, input, plan.commands);
    const scopeErrors = validateLiveHumanDecisionScope(plan.commands, candidateRecordId, input.decision);
    if (scopeErrors.length > 0) {
      return {
        status: "blocked",
        planNonce,
        candidateDisplayName,
        commandCount: plan.commands.length,
        commands: [],
        decision: input.decision,
        blockedReasons: scopeErrors,
        safeSummary: `决策计划生成失败：${scopeErrors.length} 个命令未通过安全检查。`,
      };
    }

    const safeCommands: SafeHumanDecisionPlanCommand[] = plan.commands.map((cmd) => ({
      description: cmd.description,
      action: classifyCommandAction(cmd),
    }));

    return {
      status: "planned",
      planNonce,
      candidateDisplayName,
      commandCount: safeCommands.length,
      commands: safeCommands,
      decision: plan.finalStatus,
      blockedReasons: [],
      safeSummary: `决策计划已生成：${input.decision === "offer" ? "录用" : "拒绝"}候选人 "${candidateDisplayName}"，${safeCommands.length} 条命令。`,
    };
  } catch {
    return buildBlockedPlan(FIXED_PLAN_FAILURE_MSG);
  }
}

export async function executeLiveHumanDecision(
  linkId: string,
  options: ExecuteLiveHumanDecisionOptions,
): Promise<SafeLiveHumanDecisionResult> {
  const deps = options.deps;
  const configFn = deps?.loadConfig ?? loadConfig;

  // 0. Check confirm phrases
  if (options.confirm !== LIVE_HUMAN_DECISION_CONFIRM) {
    return buildBlockedResult("", ["第一确认短语错误，拒绝执行。"]);
  }

  if (options.reviewConfirm !== REVIEWED_HUMAN_DECISION_PLAN_CONFIRM) {
    return buildBlockedResult("", ["第二确认短语错误：请审阅决策计划后使用 REVIEWED_HUMAN_DECISION_PLAN 确认。"]);
  }

  if (!options.planNonce || options.planNonce.trim().length === 0) {
    return buildBlockedResult("", ["缺少 planNonce，拒绝执行。"]);
  }

  const inputErrors = validateDecisionInput(options);
  if (inputErrors.length > 0) {
    return buildBlockedResult(options.planNonce, [inputErrors[0]!]);
  }

  // 1. Re-read candidate to get fresh recordId and recompute nonce
  let ctxResult: Awaited<ReturnType<typeof readLiveCandidateContext>>;
  try {
    ctxResult = await readLiveCandidateContext(linkId, {
      requireJob: false,
      requireResume: false,
      deps,
    });
  } catch {
    return {
      status: "failed",
      executed: false,
      planNonce: options.planNonce,
      commandCount: 0,
      successCount: 0,
      failedCount: 0,
      stoppedAtCommandIndex: null,
      safeSummary: FIXED_EXECUTION_FAILURE_MSG,
    };
  }

  if (ctxResult.status === "blocked") {
    return {
      status: "blocked",
      executed: false,
      planNonce: options.planNonce,
      commandCount: 0,
      successCount: 0,
      failedCount: 0,
      stoppedAtCommandIndex: null,
      safeSummary: ctxResult.safeSummary,
    };
  }

  const { entry, candidateRecordId, candidateId, candidateStatus } = ctxResult.context;

  if (candidateStatus !== "decision_pending") {
    return buildBlockedResult(options.planNonce, [CANDIDATE_STATUS_BLOCKED_MSG]);
  }

  // 2. Rebuild plan and recompute nonce
  let plan: ReturnType<typeof buildHumanDecisionPlan>;
  try {
    plan = buildHumanDecisionPlan({
      candidateRecordId,
      candidateId,
      decision: options.decision,
      decidedBy: options.decidedBy,
      decisionNote: options.decisionNote,
      fromStatus: "decision_pending",
    });
  } catch {
    return buildBlockedResult(options.planNonce, ["决策参数无效，请检查后重试。"]);
  }

  const recomputedNonce = computePlanNonce(linkId, entry.recordId, options, plan.commands);

  // 3. Verify planNonce matches (TOCTOU guard)
  if (recomputedNonce !== options.planNonce) {
    return buildBlockedResult(recomputedNonce, [
      "planNonce 不匹配：候选人数据或决策参数可能已变更，请重新生成决策计划。",
    ]);
  }

  // 4. Validate write scope
  const scopeErrors = validateLiveHumanDecisionScope(plan.commands, candidateRecordId, options.decision);
  if (scopeErrors.length > 0) {
    return buildBlockedResult(recomputedNonce, scopeErrors);
  }

  // 5. Check write permission
  const config = configFn();
  const configErrors = validateExecutionConfig(config);
  if (configErrors.length > 0) {
    console.error("Live human decision execution blocked due to invalid config:");
    for (const err of configErrors) {
      console.error(`  - ${err.field}: ${err.message}`);
    }
    console.error("Redacted config:", JSON.stringify(redactConfig(config), null, 2));
    return buildBlockedResult(recomputedNonce, configErrors.map((e) => `${e.field}: ${e.message}`));
  }

  // 6. Execute commands sequentially
  const { commands } = plan;
  const results: Array<{ success: boolean; commandIndex: number }> = [];
  let stoppedAtIndex: number | null = null;
  const executor = deps?.executor ?? defaultWriteExecutor;

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i]!;
    const baseToken = config.baseAppToken;
    if (!baseToken) {
      stoppedAtIndex = i;
      break;
    }

    const { command, args } = injectBaseToken(cmd, baseToken);

    try {
      const result = executor(command, args);
      const ok = result.status === "success" && result.exitCode === 0;
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
      ? `决策执行完成：${options.decision === "offer" ? "录用" : "拒绝"}候选人，${successCount}/${commands.length} 条命令成功。`
      : `决策执行未完成：${successCount} 成功，${failedCount} 失败` +
        (stoppedAtIndex ? `，在第 ${stoppedAtIndex} 条命令停止。` : "。"),
  };
}
