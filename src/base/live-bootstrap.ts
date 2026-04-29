import { spawnSync } from "node:child_process";
import type { HireLoopConfig } from "../config.js";
import { validateExecutionConfig } from "../config.js";
import { generateSetupPlan, generateSeedPlan, injectBaseToken } from "./commands.js";
import { seedFromInternal } from "./commands.js";
import { ALL_TABLES } from "./schema.js";
import { buildRecordPayload } from "./record-values.js";
import { assertLarkRecordId } from "./record-values.js";
import { runPlan, type RunResult } from "./lark-cli-runner.js";
import { buildListRecordsCommand } from "./queries.js";
import { runReadOnlyCommands, type CommandExecutor } from "./read-only-runner.js";
import { parseRecordList } from "./lark-cli-runner.js";
import { DEMO_JOB_ID, DEMO_CANDIDATE_ID } from "../fixtures/demo-data.js";

// ── Types ──

export type PreflightStatus = "ready" | "blocked";

export interface PreflightResult {
  status: PreflightStatus;
  blockedReasons: string[];
  tableStatuses: TableStatus[];
}

export interface TableStatus {
  tableName: string;
  displayName: string;
  exists: boolean;
  recordCount: number;
  readStatus: "ok" | "missing" | "failed";
}

export type BootstrapMode = "dry_run" | "execute";

export interface BootstrapReport {
  mode: BootstrapMode;
  preflight: PreflightResult;
  setup: { created: number; skipped: number; failed: number };
  seed: { created: number; skipped: number; failed: number; jobLinked: boolean };
  safeSummary: string;
}

export interface BootstrapOptions {
  config: HireLoopConfig;
  execute: boolean;
  executor?: CommandExecutor;
}

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

function extractRecordIdFromUpsert(stdout: string | null): string | null {
  if (!stdout) return null;
  try {
    const parsed = JSON.parse(stdout);
    const record = parsed?.data?.record ?? parsed?.record ?? parsed;
    const id = record?.record_id ?? record?.id;
    if (typeof id === "string" && id.length > 0) return id;
  } catch {
    // stdout is not JSON — cannot extract record ID
  }
  return null;
}

function countFromRunResult(result: RunResult): { created: number; skipped: number; failed: number } {
  let created = 0;
  let skipped = 0;
  let failed = 0;
  for (const r of result.results) {
    if (r.status === "success") created++;
    else if (r.status === "skipped") skipped++;
    else if (r.status === "failed") failed++;
  }
  return { created, skipped, failed };
}

function buildSafeSummary(report: BootstrapReport): string {
  const parts: string[] = [];
  if (report.preflight.status === "blocked") {
    parts.push(`预检未通过: ${report.preflight.blockedReasons.join("; ")}`);
    return parts.join(" | ");
  }
  parts.push(`建表: 创建 ${report.setup.created}, 跳过 ${report.setup.skipped}, 失败 ${report.setup.failed}`);
  parts.push(`种子数据: 创建 ${report.seed.created}, 跳过 ${report.seed.skipped}, 失败 ${report.seed.failed}`);
  if (report.seed.jobLinked) {
    parts.push("岗位关联: 已完成");
  }
  return parts.join(" | ");
}

function isMissingTableResult(result: { stdout: string | null; stderr: string | null }): boolean {
  const text = `${result.stdout ?? ""} ${result.stderr ?? ""}`.toLowerCase();
  if (
    text.includes("command not found") ||
    text.includes("enoent") ||
    text.includes("connection refused") ||
    text.includes("permission denied") ||
    text.includes("unauthorized")
  ) {
    return false;
  }
  return [
    "table not found",
    "table does not exist",
    "not exist",
    "not found",
    "unknown table",
    "invalid table",
    "table_id",
    "表不存在",
    "数据表不存在",
    "数据表未找到",
    "不存在",
  ].some((marker) => text.includes(marker));
}

// ── Preflight ──

export function checkTableStatuses(
  executor: CommandExecutor,
  config: HireLoopConfig,
): TableStatus[] {
  const statuses: TableStatus[] = [];

  for (const table of ALL_TABLES) {
    const cmd = buildListRecordsCommand(table.tableName, { limit: 1 });
    const result = runReadOnlyCommands({
      commands: [cmd],
      config,
      execute: true,
      executor,
    });

    if (result.blocked || result.results.length === 0) {
      statuses.push({
        tableName: table.tableName,
        displayName: table.name,
        exists: false,
        recordCount: 0,
        readStatus: "failed",
      });
      continue;
    }

    const cmdResult = result.results[0]!;
    if (cmdResult.status !== "success" || !cmdResult.stdout) {
      const missing = isMissingTableResult(cmdResult);
      statuses.push({
        tableName: table.tableName,
        displayName: table.name,
        exists: false,
        recordCount: 0,
        readStatus: missing ? "missing" : "failed",
      });
      continue;
    }

    try {
      const parsed = parseRecordList(cmdResult.stdout);
      statuses.push({
        tableName: table.tableName,
        displayName: table.name,
        exists: true,
        recordCount: parsed.total ?? parsed.records.length,
        readStatus: "ok",
      });
    } catch {
      statuses.push({
        tableName: table.tableName,
        displayName: table.name,
        exists: false,
        recordCount: 0,
        readStatus: "failed",
      });
    }
  }

  return statuses;
}

export function runPreflight(options: {
  config: HireLoopConfig;
  executor?: CommandExecutor;
}): PreflightResult {
  const { config, executor } = options;
  const blockedReasons: string[] = [];

  const status = getBootstrapStatus(config);
  if (status.blockedReasons.length > 0) {
    blockedReasons.push(...status.blockedReasons);
    return { status: "blocked", blockedReasons, tableStatuses: [] };
  }

  const defaultExecutor: CommandExecutor = (command, args) => {
    const result = spawnSync(command, args, { timeout: 30000, encoding: "utf-8" });
    return {
      description: "",
      status: result.status === 0 ? "success" as const : "failed" as const,
      stdout: result.stdout ?? null,
      stderr: result.stderr ?? null,
      exitCode: result.status ?? null,
      durationMs: 0,
    };
  };

  const exec = executor ?? defaultExecutor;
  const tableStatuses = checkTableStatuses(exec, config);

  const failedReads = tableStatuses.filter((t) => t.readStatus === "failed");
  if (failedReads.length > 0) {
    blockedReasons.push(
      "无法确认飞书 Base 表状态，请检查飞书连接、权限或 lark-cli 输出。",
    );
  }

  const nonEmptyTables = tableStatuses.filter((t) => t.exists && t.recordCount > 0);
  if (nonEmptyTables.length > 0) {
    const names = nonEmptyTables.map((t) => t.displayName).join(", ");
    blockedReasons.push(
      `以下表已有业务数据，不能自动初始化: ${names}。如需重新初始化，请先人工清空对应表。`,
    );
  }

  return {
    status: blockedReasons.length > 0 ? "blocked" : "ready",
    blockedReasons,
    tableStatuses,
  };
}

// ── Status check ──

export interface BootstrapStatus {
  canRead: boolean;
  canWrite: boolean;
  blockedReasons: string[];
}

export function getBootstrapStatus(config: HireLoopConfig): BootstrapStatus {
  const blockedReasons: string[] = [];

  if (!config.larkAppId) blockedReasons.push("飞书应用 ID 未配置");
  if (!config.larkAppSecret) blockedReasons.push("飞书应用密钥未配置");
  if (!config.baseAppToken) blockedReasons.push("Base 应用凭证未配置");
  if (!config.allowLarkRead) blockedReasons.push("HIRELOOP_ALLOW_LARK_READ 未启用");

  return {
    canRead: !!(config.larkAppId && config.larkAppSecret && config.baseAppToken && config.allowLarkRead),
    canWrite: config.allowLarkWrite,
    blockedReasons,
  };
}

// ── Setup execution ──

export function executeSetup(config: HireLoopConfig): RunResult {
  const plan = generateSetupPlan();
  return quietConsole(() => runPlan({ plan, config, execute: true }));
}

function executeSetupWithExecutor(config: HireLoopConfig, executor: CommandExecutor): RunResult {
  const plan = generateSetupPlan();
  const baseToken = config.baseAppToken;
  if (!baseToken) {
    return {
      mode: "execute",
      results: plan.commands.map((spec) => ({
        description: spec.description,
        status: "skipped" as const,
        stdout: null,
        stderr: null,
        exitCode: null,
        durationMs: 0,
      })),
      totalDurationMs: 0,
      blocked: true,
    };
  }

  const results: import("./lark-cli-runner.js").CommandResult[] = [];
  let totalDurationMs = 0;
  let blocked = false;

  for (const spec of plan.commands) {
    const { command, args } = injectBaseToken(spec, baseToken);
    const result = executor(command, args);
    totalDurationMs += result.durationMs;
    results.push({ ...result, description: spec.description });
    if (result.status === "failed") {
      blocked = true;
      break;
    }
  }

  return { mode: "execute", results, totalDurationMs, blocked };
}

// ── Seed with job link ──

export interface SeedWithJobLinkResult {
  runResult: RunResult;
  jobRecordId: string | null;
}

export function buildDemoJobSeed() {
  return seedFromInternal("jobs", {
    job_id: DEMO_JOB_ID,
    title: "AI Product Manager",
    department: "Product",
    level: "P7",
    requirements:
      "5+ years in product management. Experience with AI/ML products. " +
      "Familiarity with NLP or recommendation systems. Cross-functional collaboration. " +
      "Data-driven decision making.",
    rubric:
      "Technical depth: understanding of ML pipeline and model lifecycle. " +
      "Product sense: ability to prioritize features and define success metrics. " +
      "Communication: clarity in writing specs and presenting to stakeholders.",
    status: "open",
    owner: "demo_hiring_manager",
    created_at: "2026-04-25 00:00:00",
  });
}

export function buildDemoCandidateSeedWithLink(jobRecordId: string) {
  try {
    assertLarkRecordId("jobRecordId", jobRecordId);
  } catch {
    throw new Error("岗位记录 ID 格式不正确，无法关联候选人。");
  }

  return seedFromInternal("candidates", {
    candidate_id: DEMO_CANDIDATE_ID,
    display_name: "Candidate-Alpha",
    job: [{ id: jobRecordId }],
    resume_source: null,
    resume_text:
      "AI Product Manager with 6 years experience in technology sector. " +
      "Led development of a natural language search feature at a fictional tech company. " +
      "Managed cross-functional teams of 8-12 engineers and designers. " +
      "Bachelor's degree in Computer Science from Fictional University. " +
      "Skills: product roadmapping, SQL, Python basics, A/B testing, user research.",
    status: "new",
    screening_recommendation: null,
    talent_pool_candidate: false,
    human_decision: "none",
    human_decision_by: null,
    human_decision_note: null,
  });
}

export function executeSeedWithJobLink(options: {
  config: HireLoopConfig;
  executor?: CommandExecutor;
}): SeedWithJobLinkResult {
  const { config } = options;
  const configErrors = validateExecutionConfig(config);
  if (configErrors.length > 0) {
    const blockedResult: RunResult = {
      mode: "execute",
      results: [],
      totalDurationMs: 0,
      blocked: true,
    };
    return { runResult: blockedResult, jobRecordId: null };
  }

  const defaultExecutor: CommandExecutor = (command, args) => {
    const result = spawnSync(command, args, { timeout: 30000, encoding: "utf-8" });
    return {
      description: "",
      status: result.status === 0 ? "success" as const : "failed" as const,
      stdout: result.stdout ?? null,
      stderr: result.stderr ?? null,
      exitCode: result.status ?? null,
      durationMs: 0,
    };
  };
  const executor = options.executor ?? defaultExecutor;

  const baseToken = config.baseAppToken;
  if (!baseToken) {
    const plan = generateSeedPlan([]);
    const emptyResult: RunResult = {
      mode: "execute",
      results: plan.commands.map((cmd) => ({
        description: cmd.description,
        status: "skipped" as const,
        stdout: null,
        stderr: null,
        exitCode: null,
        durationMs: 0,
      })),
      totalDurationMs: 0,
      blocked: true,
    };
    return { runResult: emptyResult, jobRecordId: null };
  }

  // Step 1: Create job record
  const jobSeed = buildDemoJobSeed();
  const jobPayload = buildRecordPayload(jobSeed.tableName, jobSeed.record);
  const jobJsonStr = JSON.stringify(jobPayload);

  const jobCommand = "lark-cli";
  const jobArgs = [
    "base", "+record-upsert",
    "--base-token", baseToken,
    "--table-id", jobSeed.displayName,
    "--json", jobJsonStr,
  ];

  console.log(`[EXECUTING] 创建岗位记录: ${jobSeed.displayName}`);
  const jobResult = executor(jobCommand, jobArgs);
  const jobRecordId = extractRecordIdFromUpsert(jobResult.stdout);

  const jobCmdResult = {
    description: `创建岗位记录 "${jobSeed.displayName}"`,
    status: jobResult.status,
    stdout: null,
    stderr: null,
    exitCode: jobResult.exitCode,
    durationMs: jobResult.durationMs,
  };

  if (jobResult.status === "failed" || !jobRecordId) {
    return {
      runResult: {
        mode: "execute",
        results: [jobCmdResult],
        totalDurationMs: jobResult.durationMs,
        blocked: false,
      },
      jobRecordId: null,
    };
  }

  // Step 2: Create candidate record with job link
  const candidateSeed = buildDemoCandidateSeedWithLink(jobRecordId);
  const candidatePayload = buildRecordPayload(candidateSeed.tableName, candidateSeed.record);
  const candidateJsonStr = JSON.stringify(candidatePayload);

  const candidateArgs = [
    "base", "+record-upsert",
    "--base-token", baseToken,
    "--table-id", candidateSeed.displayName,
    "--json", candidateJsonStr,
  ];

  console.log(`[EXECUTING] 创建候选人记录: ${candidateSeed.displayName}`);
  const candidateResult = executor(jobCommand, candidateArgs);

  const candidateCmdResult = {
    description: `创建候选人记录 "${candidateSeed.displayName}"`,
    status: candidateResult.status,
    stdout: null,
    stderr: null,
    exitCode: candidateResult.exitCode,
    durationMs: candidateResult.durationMs,
  };

  return {
    runResult: {
      mode: "execute",
      results: [jobCmdResult, candidateCmdResult],
      totalDurationMs: jobResult.durationMs + candidateResult.durationMs,
      blocked: false,
    },
    jobRecordId,
  };
}

// ── Main bootstrap ──

export function bootstrap(options: BootstrapOptions): BootstrapReport {
  const { config, execute } = options;
  const mode: BootstrapMode = execute ? "execute" : "dry_run";

  const preflight = runPreflight({ config, executor: options.executor });

  if (!execute) {
    const setupPlan = generateSetupPlan();
    const setupCount = setupPlan.commands.length;
    const report: BootstrapReport = {
      mode,
      preflight,
      setup: { created: 0, skipped: setupCount, failed: 0 },
      seed: { created: 0, skipped: 2, failed: 0, jobLinked: false },
      safeSummary: "",
    };
    report.safeSummary = buildSafeSummary(report);
    return report;
  }

  // Execute mode — check write guard
  if (!config.allowLarkWrite) {
    const report: BootstrapReport = {
      mode,
      preflight,
      setup: { created: 0, skipped: 0, failed: 0 },
      seed: { created: 0, skipped: 0, failed: 0, jobLinked: false },
      safeSummary: "",
    };
    report.safeSummary = "写入未启用: 需设置 HIRELOOP_ALLOW_LARK_WRITE=1";
    return report;
  }

  if (preflight.status === "blocked") {
    const report: BootstrapReport = {
      mode,
      preflight,
      setup: { created: 0, skipped: 0, failed: 0 },
      seed: { created: 0, skipped: 0, failed: 0, jobLinked: false },
      safeSummary: "",
    };
    report.safeSummary = buildSafeSummary(report);
    return report;
  }

  // Execute setup
  const setupResult = options.executor
    ? executeSetupWithExecutor(config, options.executor)
    : executeSetup(config);
  const setupCounts = countFromRunResult(setupResult);

  // Check if setup had critical failures
  const hasCriticalFailure = setupResult.results.some((r) => r.status === "failed");
  if (hasCriticalFailure) {
    const report: BootstrapReport = {
      mode,
      preflight,
      setup: setupCounts,
      seed: { created: 0, skipped: 0, failed: 0, jobLinked: false },
      safeSummary: "",
    };
    report.safeSummary = buildSafeSummary(report);
    return report;
  }

  // Execute seed with job link
  const seedResult = executeSeedWithJobLink({ config, executor: options.executor });
  let seedCreated = 0;
  let seedSkipped = 0;
  let seedFailed = 0;
  for (const r of seedResult.runResult.results) {
    if (r.status === "success") seedCreated++;
    else if (r.status === "skipped") seedSkipped++;
    else if (r.status === "failed") seedFailed++;
  }

  const report: BootstrapReport = {
    mode,
    preflight,
    setup: setupCounts,
    seed: {
      created: seedCreated,
      skipped: seedSkipped,
      failed: seedFailed,
      jobLinked: !!seedResult.jobRecordId,
    },
    safeSummary: "",
  };
  report.safeSummary = buildSafeSummary(report);
  return report;
}

// ── Validation ──

export function validateBootstrapReport(report: BootstrapReport): void {
  if (!report.mode || !["dry_run", "execute"].includes(report.mode)) {
    throw new Error(`Invalid bootstrap mode: ${report.mode}`);
  }
  if (!report.preflight || !report.preflight.status) {
    throw new Error("Bootstrap report missing preflight");
  }
  if (!report.setup || typeof report.setup.created !== "number") {
    throw new Error("Bootstrap report missing setup counts");
  }
  if (!report.seed || typeof report.seed.created !== "number") {
    throw new Error("Bootstrap report missing seed counts");
  }
  if (typeof report.safeSummary !== "string") {
    throw new Error("Bootstrap report missing safeSummary");
  }
}
