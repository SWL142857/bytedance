import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { injectBaseToken, type BaseCommandSpec } from "../base/commands.js";
import { buildListRecordsCommand } from "../base/queries.js";
import { runReadOnlyCommands, type CommandExecutor, type CommandResult } from "../base/read-only-runner.js";
import { parseRecordList } from "../base/lark-cli-runner.js";
import { loadConfig, validateExecutionConfig, redactConfig, type HireLoopConfig } from "../config.js";
import { getLiveBaseStatus } from "../server/live-base.js";
import { runAnalytics, type AnalyticsInput, type AnalyticsCandidateSnapshot, type AnalyticsEvaluationSnapshot, type AnalyticsAgentRunSnapshot } from "../agents/analytics.js";
import { DeterministicLlmClient } from "../llm/deterministic-client.js";
import type { CandidateStatus, ScreeningRecommendation } from "../types/state.js";

// ── Types ──

export interface SafeAnalyticsReportPlanCommand {
  description: string;
  targetTable: string;
  action: "record_upsert";
}

export interface SafeLiveAnalyticsReportPlan {
  status: "planned" | "blocked" | "needs_review";
  planNonce: string;
  periodStart: string;
  periodEnd: string;
  candidateCount: number;
  evaluationCount: number;
  agentRunCount: number;
  commandCount: number;
  commands: SafeAnalyticsReportPlanCommand[];
  blockedReasons: string[];
  safeSummary: string;
}

export interface SafeLiveAnalyticsReportResult {
  status: "success" | "blocked" | "failed";
  executed: boolean;
  planNonce: string;
  commandCount: number;
  successCount: number;
  failedCount: number;
  stoppedAtCommandIndex: number | null;
  safeSummary: string;
}

export interface LiveAnalyticsDeps {
  loadConfig?: () => HireLoopConfig;
  executor?: CommandExecutor;
  cliAvailable?: () => boolean;
}

export interface LiveAnalyticsReportInput {
  periodStart?: string;
  periodEnd?: string;
}

export interface ExecuteLiveAnalyticsReportOptions {
  confirm: string;
  reviewConfirm: string;
  planNonce: string;
  periodStart?: string;
  periodEnd?: string;
  deps?: LiveAnalyticsDeps;
}

// ── Constants ──

export const LIVE_ANALYTICS_REPORT_CONFIRM = "EXECUTE_LIVE_ANALYTICS_REPORT_WRITE";
export const REVIEWED_ANALYTICS_REPORT_PLAN_CONFIRM = "REVIEWED_LIVE_ANALYTICS_REPORT_PLAN";
const READ_LIMIT = 200;
const VALID_CANDIDATE_STATUSES = new Set<CandidateStatus>([
  "new", "parsed", "screened", "interview_kit_ready", "decision_pending", "offer", "rejected",
]);
const VALID_SCREENING_RECOMMENDATIONS = new Set<ScreeningRecommendation>([
  "strong_match", "review_needed", "weak_match",
]);
const DISPLAY_TABLE_TO_SAFE_TABLE = new Map([
  ["Reports", "reports"],
  ["Agent Runs", "agent_runs"],
  ["Candidates", "candidates"],
  ["Evaluations", "evaluations"],
  ["Interview Kits", "interview_kits"],
  ["Resume Facts", "resume_facts"],
]);

// ── Helpers ──

function quietConsole<T>(fn: () => T): T {
  const origLog = console.log;
  const origError = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.log = origLog;
    console.error = origError;
  }
}

function extractTextField(fields: Record<string, unknown>, fieldName: string): string | null {
  const val = fields[fieldName];
  if (typeof val === "string" && val.length > 0) return val;
  if (typeof val === "object" && val !== null && !Array.isArray(val)) {
    const obj = val as Record<string, unknown>;
    return typeof obj.text === "string" && obj.text.length > 0 ? obj.text : null;
  }
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

function extractBoolean(fields: Record<string, unknown>, fieldName: string): boolean {
  const val = fields[fieldName];
  return val === true || val === "true" || val === 1;
}

function isValidScreeningRecommendation(val: string | null): val is ScreeningRecommendation {
  return val !== null && VALID_SCREENING_RECOMMENDATIONS.has(val as ScreeningRecommendation);
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:${min}:${s}`;
}

function defaultPeriod(): { periodStart: string; periodEnd: string } {
  const now = new Date();
  const periodEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  const periodStart = new Date(periodEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
  periodStart.setHours(0, 0, 0, 0);
  return { periodStart: formatDate(periodStart), periodEnd: formatDate(periodEnd) };
}

function resolvePeriod(input: LiveAnalyticsReportInput): { periodStart: string; periodEnd: string } {
  const fallback = defaultPeriod();
  return {
    periodStart: input.periodStart ?? fallback.periodStart,
    periodEnd: input.periodEnd ?? fallback.periodEnd,
  };
}

function defaultWriteExecutor(command: string, args: string[]): CommandResult {
  const start = Date.now();
  const result = spawnSync(command, args, { timeout: 30000, encoding: "utf-8" });
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
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function computePlanNonce(
  periodStart: string,
  periodEnd: string,
  dataDigest: string,
  commands: BaseCommandSpec[],
): string {
  const parts: string[] = [periodStart, periodEnd, dataDigest];
  for (const cmd of commands) {
    parts.push(cmd.command);
    parts.push(cmd.args.join("\x00"));
  }
  const canonical = parts.join("\x01");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

function buildBlockedPlan(reason: string): SafeLiveAnalyticsReportPlan {
  return {
    status: "blocked",
    planNonce: "",
    periodStart: "",
    periodEnd: "",
    candidateCount: 0,
    evaluationCount: 0,
    agentRunCount: 0,
    commandCount: 0,
    commands: [],
    blockedReasons: [reason],
    safeSummary: reason,
  };
}

function buildBlockedResult(planNonce: string, reasons: string[]): SafeLiveAnalyticsReportResult {
  return {
    status: "blocked",
    executed: false,
    planNonce,
    commandCount: 0,
    successCount: 0,
    failedCount: 0,
    stoppedAtCommandIndex: null,
    safeSummary: reasons[0] ?? "报告执行被阻止。",
  };
}

function classifyTargetTable(cmd: BaseCommandSpec): string {
  const tableIdIdx = cmd.args.indexOf("--table-id");
  if (tableIdIdx >= 0 && tableIdIdx + 1 < cmd.args.length) {
    const displayName = cmd.args[tableIdIdx + 1]!;
    return DISPLAY_TABLE_TO_SAFE_TABLE.get(displayName) ?? displayName.toLowerCase();
  }
  return "unknown";
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).sort().join(",")}]`;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${stableJson(obj[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function computeDataDigest(data: {
  candidates: AnalyticsCandidateSnapshot[];
  evaluations: AnalyticsEvaluationSnapshot[];
  agentRuns: AnalyticsAgentRunSnapshot[];
}): string {
  return createHash("sha256").update(stableJson(data)).digest("hex").slice(0, 16);
}

function buildReportId(periodStart: string, periodEnd: string, dataDigest: string): string {
  const digest = createHash("sha256")
    .update(periodStart)
    .update("\x00")
    .update(periodEnd)
    .update("\x00")
    .update(dataDigest)
    .digest("hex")
    .slice(0, 16);
  return `rpt_live_${digest}`;
}

function normalizeLiveAnalyticsCommands(commands: BaseCommandSpec[], reportId: string): BaseCommandSpec[] {
  return commands.map((cmd) => {
    if (classifyTargetTable(cmd) !== "agent_runs") {
      return cmd;
    }

    const payload = parseCommandPayload(cmd);
    if (!payload) return cmd;

    const normalizedPayload = {
      ...payload,
      run_id: `run_analytics_${reportId}`,
      duration_ms: 0,
    };
    const jsonIdx = cmd.args.indexOf("--json");
    if (jsonIdx < 0 || jsonIdx + 1 >= cmd.args.length) return cmd;

    const args = [...cmd.args];
    args[jsonIdx + 1] = JSON.stringify(normalizedPayload);

    const redactedArgs = [...cmd.redactedArgs];
    const redactedJsonIdx = redactedArgs.indexOf("--json");
    if (redactedJsonIdx >= 0 && redactedJsonIdx + 1 < redactedArgs.length) {
      redactedArgs[redactedJsonIdx + 1] = args[jsonIdx + 1]!;
    }

    return { ...cmd, args, redactedArgs };
  });
}

// ── Scope validation ──

const ALLOWED_REPORT_FIELDS = new Set([
  "report_id", "period_start", "period_end", "funnel_summary", "quality_summary",
  "bottlenecks", "talent_pool_suggestions", "recommendations", "created_by_agent",
]);

export function validateLiveAnalyticsReportScope(commands: BaseCommandSpec[]): string[] {
  const blockedReasons: string[] = [];

  for (const cmd of commands) {
    if (cmd.description.includes("->")) {
      blockedReasons.push(`报告计划不允许状态转换: ${cmd.description}`);
    }

    if (!cmd.writesRemote) {
      blockedReasons.push(`非写入命令混入报告计划: ${cmd.description}`);
      continue;
    }

    const isUpsert =
      cmd.command === "lark-cli" &&
      cmd.args[0] === "base" &&
      cmd.args[1] === "+record-upsert";

    if (!isUpsert) {
      blockedReasons.push(`不允许的写入命令: ${cmd.description}`);
      continue;
    }

    const targetTable = classifyTargetTable(cmd);

    // Agent Runs — audit record, allow
    if (targetTable === "agent_runs") {
      // Agent Runs payload must not contain sensitive fields
      const payload = parseCommandPayload(cmd);
      if (payload) {
        const forbidden = ["resume_text", "resumeText", "raw_prompt", "prompt_text", "raw_response", "stdout", "stderr", "payload"];
        for (const key of Object.keys(payload)) {
          if (forbidden.includes(key)) {
            blockedReasons.push(`Agent Runs 包含敏感字段 "${key}": ${cmd.description}`);
          }
        }
        const serialized = JSON.stringify(payload);
        if (/rec_[a-zA-Z0-9_]+/.test(serialized)) {
          blockedReasons.push(`Agent Runs 包含记录 ID: ${cmd.description}`);
        }
      }
      continue;
    }

    // Reports — validate fields
    if (targetTable === "reports") {
      const payload = parseCommandPayload(cmd);
      if (payload) {
        const keys = Object.keys(payload);
        for (const key of keys) {
          if (!ALLOWED_REPORT_FIELDS.has(key)) {
            blockedReasons.push(`Reports 包含不允许的字段 "${key}": ${cmd.description}`);
          }
        }
      }
      continue;
    }

    // Block Candidates, Evaluations, Interview Kits, Resume Facts
    if (["candidates", "evaluations", "interview_kits", "resume_facts"].includes(targetTable)) {
      blockedReasons.push(`报告计划不允许写入 "${targetTable}": ${cmd.description}`);
      continue;
    }

    blockedReasons.push(`报告计划包含未知目标表: ${cmd.description}`);
  }

  return [...new Set(blockedReasons)];
}

// ── Read Base data ──

interface ReadBaseDataResult {
  status: "ok" | "blocked";
  candidates: AnalyticsCandidateSnapshot[];
  evaluations: AnalyticsEvaluationSnapshot[];
  agentRuns: AnalyticsAgentRunSnapshot[];
  safeSummary: string;
  candidateRecordIdMap: Map<string, string>; // recordId -> candidate_id
  dataDigest: string;
}

function readBaseData(
  executor: CommandExecutor,
  config: HireLoopConfig,
  deps?: LiveAnalyticsDeps,
): ReadBaseDataResult {
  const baseStatus = getLiveBaseStatus({
    loadConfig: () => config,
    cliAvailable: deps?.cliAvailable,
  });
  if (baseStatus.blockedReasons.length > 0) {
    return {
      status: "blocked",
      candidates: [],
      evaluations: [],
      agentRuns: [],
      safeSummary: "飞书只读未就绪，无法读取数据。",
      candidateRecordIdMap: new Map(),
      dataDigest: "",
    };
  }

  const readTables = ["candidates", "evaluations", "agent_runs"] as const;
  const readResults = new Map<string, { stdout: string | null; status: string }>();

  for (const table of readTables) {
    const cmd = buildListRecordsCommand(table, { limit: READ_LIMIT });
    const result = quietConsole(() => runReadOnlyCommands({
      commands: [cmd],
      config,
      execute: true,
      executor,
    }));
    if (result.blocked || result.results.length === 0) {
      return {
        status: "blocked",
        candidates: [],
        evaluations: [],
        agentRuns: [],
        safeSummary: `读取 ${table} 表失败。`,
        candidateRecordIdMap: new Map(),
        dataDigest: "",
      };
    }
    const cmdResult = result.results[0]!;
    if (cmdResult.status !== "success" || !cmdResult.stdout) {
      return {
        status: "blocked",
        candidates: [],
        evaluations: [],
        agentRuns: [],
        safeSummary: `读取 ${table} 表失败。`,
        candidateRecordIdMap: new Map(),
        dataDigest: "",
      };
    }
    readResults.set(table, { stdout: cmdResult.stdout, status: cmdResult.status });
  }

  // Parse candidates
  const candidateRecordIdMap = new Map<string, string>();
  let candidateRecords: Array<{ id: string; fields: Record<string, unknown> }>;
  try {
    candidateRecords = parseRecordList(readResults.get("candidates")!.stdout!).records;
  } catch {
    return { status: "blocked", candidates: [], evaluations: [], agentRuns: [], safeSummary: "候选人数据解析失败。", candidateRecordIdMap: new Map(), dataDigest: "" };
  }

  const candidates: AnalyticsCandidateSnapshot[] = [];
  for (const [index, record] of candidateRecords.entries()) {
    const cid = extractTextField(record.fields, "candidate_id") ?? `candidate_${index + 1}`;
    candidateRecordIdMap.set(record.id, cid);

    const statusRaw = extractTextField(record.fields, "status");
    const status = VALID_CANDIDATE_STATUSES.has(statusRaw as CandidateStatus) ? statusRaw as CandidateStatus : "new";
    const rec = extractTextField(record.fields, "screening_recommendation");
    const screeningRecommendation = isValidScreeningRecommendation(rec) ? rec : null;
    const talentPoolCandidate = extractBoolean(record.fields, "talent_pool_candidate");

    candidates.push({ candidateId: cid, status, screeningRecommendation, talentPoolCandidate });
  }

  // Parse evaluations
  let evalRecords: Array<{ id: string; fields: Record<string, unknown> }>;
  try {
    evalRecords = parseRecordList(readResults.get("evaluations")!.stdout!).records;
  } catch {
    return { status: "blocked", candidates: [], evaluations: [], agentRuns: [], safeSummary: "评估数据解析失败。", candidateRecordIdMap: new Map(), dataDigest: "" };
  }

  const evaluations: AnalyticsEvaluationSnapshot[] = [];
  for (const [index, record] of evalRecords.entries()) {
    const linkedCandidateRecordId = extractLinkRecordId(record.fields, "candidate");
    const candidateId = (linkedCandidateRecordId && candidateRecordIdMap.get(linkedCandidateRecordId)) ?? `candidate_unknown_${index + 1}`;
    const dimension = extractTextField(record.fields, "dimension") ?? "unknown";
    const ratingRaw = extractTextField(record.fields, "rating");
    const rating = (ratingRaw === "strong" || ratingRaw === "medium" || ratingRaw === "weak") ? ratingRaw : "medium";
    const recRaw = extractTextField(record.fields, "recommendation");
    const recommendation = isValidScreeningRecommendation(recRaw) ? recRaw : "review_needed";
    const fairnessRaw = extractTextField(record.fields, "fairness_flags");
    const fairnessFlags = fairnessRaw ? fairnessRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];
    const talentPoolSignal = extractTextField(record.fields, "talent_pool_signal");

    evaluations.push({ candidateId, dimension, rating, recommendation, fairnessFlags, talentPoolSignal });
  }

  // Parse agent runs
  let runRecords: Array<{ id: string; fields: Record<string, unknown> }>;
  try {
    runRecords = parseRecordList(readResults.get("agent_runs")!.stdout!).records;
  } catch {
    return { status: "blocked", candidates: [], evaluations: [], agentRuns: [], safeSummary: "Agent Runs 数据解析失败。", candidateRecordIdMap: new Map(), dataDigest: "" };
  }

  const agentRuns: AnalyticsAgentRunSnapshot[] = [];
  for (const record of runRecords) {
    const agentName = extractTextField(record.fields, "agent_name") ?? "unknown";
    const runStatusRaw = extractTextField(record.fields, "run_status");
    const runStatus = (runStatusRaw === "success" || runStatusRaw === "failed" || runStatusRaw === "retried" || runStatusRaw === "skipped")
      ? runStatusRaw : "failed";

    agentRuns.push({ agentName, runStatus });
  }

  candidates.sort((a, b) => stableJson(a).localeCompare(stableJson(b)));
  evaluations.sort((a, b) => stableJson(a).localeCompare(stableJson(b)));
  agentRuns.sort((a, b) => stableJson(a).localeCompare(stableJson(b)));

  const dataForDigest = { candidates, evaluations, agentRuns };

  return {
    status: "ok",
    candidates,
    evaluations,
    agentRuns,
    safeSummary: "",
    candidateRecordIdMap,
    dataDigest: computeDataDigest(dataForDigest),
  };
}

// ── Public API ──

export async function generateLiveAnalyticsReportPlan(
  input: LiveAnalyticsReportInput = {},
  deps?: LiveAnalyticsDeps,
): Promise<SafeLiveAnalyticsReportPlan> {
  try {
    const { periodStart, periodEnd } = resolvePeriod(input);

    const configFn = deps?.loadConfig ?? loadConfig;
    const config = configFn();
    const executor = deps?.executor ?? defaultWriteExecutor;

    // Read Base data
    const data = readBaseData(executor, config, deps);
    if (data.status === "blocked") {
      return buildBlockedPlan(data.safeSummary);
    }

    if (data.candidates.length === 0) {
      return {
        status: "needs_review",
        planNonce: "",
        periodStart,
        periodEnd,
        candidateCount: 0,
        evaluationCount: 0,
        agentRunCount: 0,
        commandCount: 0,
        commands: [],
        blockedReasons: ["没有候选人数据，无法生成报告。"],
        safeSummary: "没有候选人数据，无法生成报告。",
      };
    }

    // Run analytics agent
    const reportId = buildReportId(periodStart, periodEnd, data.dataDigest);
    const analyticsInput: AnalyticsInput = {
      reportId,
      periodStart,
      periodEnd,
      candidates: data.candidates,
      evaluations: data.evaluations,
      agentRuns: data.agentRuns,
    };

    const client = new DeterministicLlmClient();
    const agentResult = await runAnalytics(client, analyticsInput);
    const commands = normalizeLiveAnalyticsCommands(agentResult.commands, reportId);

    // Validate write scope
    const scopeErrors = validateLiveAnalyticsReportScope(commands);
    if (scopeErrors.length > 0) {
      return {
        status: "blocked",
        planNonce: computePlanNonce(periodStart, periodEnd, data.dataDigest, commands),
        periodStart,
        periodEnd,
        candidateCount: data.candidates.length,
        evaluationCount: data.evaluations.length,
        agentRunCount: data.agentRuns.length,
        commandCount: commands.length,
        commands: [],
        blockedReasons: scopeErrors,
        safeSummary: `报告计划生成失败：${scopeErrors.length} 个命令未通过安全检查。`,
      };
    }

    const planNonce = computePlanNonce(periodStart, periodEnd, data.dataDigest, commands);

    const safeCommands: SafeAnalyticsReportPlanCommand[] = commands.map((cmd) => ({
      description: cmd.description,
      targetTable: classifyTargetTable(cmd),
      action: "record_upsert" as const,
    }));

    return {
      status: "planned",
      planNonce,
      periodStart,
      periodEnd,
      candidateCount: data.candidates.length,
      evaluationCount: data.evaluations.length,
      agentRunCount: data.agentRuns.length,
      commandCount: safeCommands.length,
      commands: safeCommands,
      blockedReasons: [],
      safeSummary: `报告计划已生成：${data.candidates.length} 位候选人，${data.evaluations.length} 条评估，${safeCommands.length} 条写入命令。`,
    };
  } catch {
    return buildBlockedPlan("报告计划生成失败，请稍后重试。");
  }
}

export async function executeLiveAnalyticsReport(
  options: ExecuteLiveAnalyticsReportOptions,
): Promise<SafeLiveAnalyticsReportResult> {
  const deps = options.deps;
  const configFn = deps?.loadConfig ?? loadConfig;

  // 0. Check confirm phrases — must block before any read
  if (options.confirm !== LIVE_ANALYTICS_REPORT_CONFIRM) {
    return buildBlockedResult("", ["第一确认短语错误，拒绝执行。"]);
  }

  if (options.reviewConfirm !== REVIEWED_ANALYTICS_REPORT_PLAN_CONFIRM) {
    return buildBlockedResult("", ["第二确认短语错误：请审阅报告计划后使用 REVIEWED_LIVE_ANALYTICS_REPORT_PLAN 确认。"]);
  }

  if (!options.planNonce || options.planNonce.trim().length === 0) {
    return buildBlockedResult("", ["缺少 planNonce，拒绝执行。"]);
  }

  // 1. Re-read Base data
  const config = configFn();
  const executor = deps?.executor ?? ((command: string, args: string[]) => defaultWriteExecutor(command, args));

  const data = readBaseData(executor, config, deps);
  if (data.status === "blocked") {
    return buildBlockedResult(options.planNonce, [data.safeSummary]);
  }

  if (data.candidates.length === 0) {
    return buildBlockedResult(options.planNonce, ["没有候选人数据，无法生成报告。"]);
  }

  // 2. Re-run analytics and recompute nonce
  const { periodStart, periodEnd } = resolvePeriod(options);

  const reportId = buildReportId(periodStart, periodEnd, data.dataDigest);
  const analyticsInput: AnalyticsInput = {
    reportId,
    periodStart,
    periodEnd,
    candidates: data.candidates,
    evaluations: data.evaluations,
    agentRuns: data.agentRuns,
  };

  const client = new DeterministicLlmClient();
  const agentResult = await runAnalytics(client, analyticsInput);
  const commands = normalizeLiveAnalyticsCommands(agentResult.commands, reportId);

  const recomputedNonce = computePlanNonce(periodStart, periodEnd, data.dataDigest, commands);

  // 3. Verify planNonce matches (TOCTOU guard)
  if (recomputedNonce !== options.planNonce) {
    return buildBlockedResult(recomputedNonce, [
      "planNonce 不匹配：数据或周期可能已变更，请重新生成报告计划。",
    ]);
  }

  // 4. Validate write scope
  const scopeErrors = validateLiveAnalyticsReportScope(commands);
  if (scopeErrors.length > 0) {
    return buildBlockedResult(recomputedNonce, scopeErrors);
  }

  // 5. Check write permission
  const configErrors = validateExecutionConfig(config);
  if (configErrors.length > 0) {
    console.error("Live analytics report execution blocked due to invalid config:");
    for (const err of configErrors) {
      console.error(`  - ${err.field}: ${err.message}`);
    }
    console.error("Redacted config:", JSON.stringify(redactConfig(config), null, 2));
    return buildBlockedResult(recomputedNonce, configErrors.map((e) => `${e.field}: ${e.message}`));
  }

  // 6. Execute commands sequentially
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
      ? `报告执行完成：${successCount}/${commands.length} 条命令成功。`
      : `报告执行未完成：${successCount} 成功，${failedCount} 失败` +
        (stoppedAtIndex ? `，在第 ${stoppedAtIndex} 条命令停止。` : "。"),
  };
}
