import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

type Row = Record<string, string>;

interface ExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

interface TableListResponse {
  ok: boolean;
  data?: {
    items?: Array<{ table_name: string; table_id: string }>;
  };
}

interface RecordListResponse {
  ok: boolean;
  data?: {
    data?: unknown[][];
    fields?: string[];
    record_id_list?: string[];
  };
}

const { values } = parseArgs({
  options: {
    "base-token": { type: "string" },
    root: { type: "string", default: "tmp/competition-remote" },
    "candidate-limit": { type: "string", default: "12" },
    "edge-limit": { type: "string", default: "20" },
  },
});

const parsedBaseToken = values["base-token"];
if (!parsedBaseToken) {
  console.error("Missing --base-token");
  process.exit(1);
}
const baseToken: string = parsedBaseToken;

const root = values.root ?? "tmp/competition-remote";
const candidateLimit = Number(values["candidate-limit"] ?? "80");
const edgeLimit = Number(values["edge-limit"] ?? "120");

function csvPath(name: string): string {
  return join(root, "artifacts", "memory_graph", name);
}

function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  const [headers, ...body] = rows;
  if (!headers) return [];
  return body
    .filter((r) => r.some((c) => c.length > 0))
    .map((r) => {
      const out: Row = {};
      for (let i = 0; i < headers.length; i++) {
        out[headers[i]!] = r[i] ?? "";
      }
      return out;
    });
}

function readCsv(name: string): Row[] {
  const file = csvPath(name);
  if (!existsSync(file)) throw new Error(`Missing CSV: ${file}`);
  return parseCsv(readFileSync(file, "utf8"));
}

function clip(value: unknown, max = 1600): string {
  const s = value == null ? "" : String(value);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function execLark(args: string[], quiet = false): ExecResult {
  const result = spawnSync("lark-cli", args, {
    encoding: "utf8",
    timeout: 60000,
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const ok = (result.status ?? 1) === 0;
  if (!quiet) {
    if (ok) console.log(`[OK] lark-cli ${args.slice(0, 2).join(" ")} ${args.includes("--name") ? args[args.indexOf("--name") + 1] : ""}`);
    else console.error(`[FAIL] lark-cli ${args.join(" ")}\n${stderr || stdout}`);
  }
  return { ok, stdout, stderr };
}

function parseJson<T>(text: string): T {
  return JSON.parse(text) as T;
}

function getExistingTables(): Set<string> {
  const res = execLark(["base", "+table-list", "--base-token", baseToken], true);
  if (!res.ok) return new Set();
  const parsed = parseJson<TableListResponse>(res.stdout);
  const items = parsed.data?.items ?? [];
  return new Set(items.map((item) => item.table_name));
}

function loadExistingIndex(table: string, keyField: string): Map<string, string> {
  const res = execLark(["base", "+record-list", "--base-token", baseToken, "--table-id", table, "--limit", "200"], true);
  const index = new Map<string, string>();
  if (!res.ok) return index;
  const parsed = parseJson<RecordListResponse>(res.stdout);
  const rows = parsed.data?.data ?? [];
  const fields = parsed.data?.fields ?? [];
  const recordIds = parsed.data?.record_id_list ?? [];
  const keyIndex = fields.indexOf(keyField);
  if (keyIndex < 0) return index;
  rows.forEach((row, i) => {
    const recordId = recordIds[i];
    const keyValue = row[keyIndex];
    if (recordId && keyValue != null) {
      index.set(String(keyValue), recordId);
    }
  });
  return index;
}

function tableFields(fields: Array<Record<string, unknown>>): string {
  return JSON.stringify(fields);
}

function createTable(name: string, fields: Array<Record<string, unknown>>): void {
  const existingTables = getExistingTables();
  if (existingTables.has(name)) {
    console.log(`[SKIP] table already exists: ${name}`);
    return;
  }
  const res = execLark([
    "base",
    "+table-create",
    "--base-token",
    baseToken,
    "--name",
    name,
    "--fields",
    tableFields(fields),
  ]);
  if (!res.ok) process.exit(1);
}

function upsertWithKey(table: string, keyField: string, record: Record<string, unknown>, index: Map<string, string>): void {
  const keyValue = record[keyField];
  const recordId = keyValue != null ? index.get(String(keyValue)) : undefined;
  const res = execLark([
    "base",
    "+record-upsert",
    "--base-token",
    baseToken,
    "--table-id",
    table,
    ...(recordId ? ["--record-id", recordId] : []),
    "--json",
    JSON.stringify(record),
  ], true);
  if (!res.ok) {
    console.error(`[FAIL] upsert ${table}: ${res.stderr || res.stdout}`);
    process.exit(1);
  }
}

function now(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function stableId(prefix: string, parts: string[]): string {
  return `${prefix}-${createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 10)}`;
}

const fields = {
  jobs: [
    { type: "text", name: "job_id" },
    { type: "text", name: "title" },
    { type: "text", name: "normalized_role_name" },
    { type: "text", name: "requirements" },
    { type: "number", name: "candidate_count", style: { type: "plain", precision: 0 } },
    { type: "number", name: "select_count", style: { type: "plain", precision: 0 } },
    { type: "number", name: "reject_count", style: { type: "plain", precision: 0 } },
    { type: "text", name: "rubric" },
    { type: "select", name: "status", multiple: false, options: [{ name: "open" }, { name: "paused" }, { name: "closed" }] },
    { type: "text", name: "owner" },
    { type: "datetime", name: "created_at", style: { format: "yyyy-MM-dd HH:mm" } },
  ],
  candidates: [
    { type: "text", name: "candidate_id" },
    { type: "text", name: "display_name" },
    { type: "text", name: "job_id" },
    { type: "text", name: "resume_id" },
    { type: "text", name: "resume_text" },
    { type: "select", name: "status", multiple: false, options: [{ name: "new" }, { name: "parsed" }, { name: "screened" }, { name: "interview_kit_ready" }, { name: "decision_pending" }, { name: "offer" }, { name: "rejected" }] },
    { type: "select", name: "screening_recommendation", multiple: false, options: [{ name: "strong_match" }, { name: "review_needed" }, { name: "weak_match" }] },
    { type: "checkbox", name: "talent_pool_candidate" },
    { type: "select", name: "human_decision", multiple: false, options: [{ name: "offer" }, { name: "rejected" }, { name: "none" }] },
    { type: "text", name: "human_decision_by" },
    { type: "text", name: "human_decision_note" },
  ],
  resumeFacts: [
    { type: "text", name: "candidate_id" },
    { type: "select", name: "fact_type", multiple: false, options: [{ name: "education" }, { name: "work_experience" }, { name: "skill" }, { name: "other" }] },
    { type: "text", name: "fact_text" },
    { type: "text", name: "source_excerpt" },
    { type: "select", name: "confidence", multiple: false, options: [{ name: "high" }, { name: "medium" }, { name: "low" }] },
    { type: "text", name: "created_by_agent" },
  ],
  evaluations: [
    { type: "text", name: "candidate_id" },
    { type: "text", name: "job_id" },
    { type: "text", name: "dimension" },
    { type: "select", name: "rating", multiple: false, options: [{ name: "strong" }, { name: "medium" }, { name: "weak" }] },
    { type: "number", name: "score", style: { type: "plain", precision: 2 } },
    { type: "select", name: "recommendation", multiple: false, options: [{ name: "strong_match" }, { name: "review_needed" }, { name: "weak_match" }] },
    { type: "text", name: "reason" },
    { type: "text", name: "evidence_refs" },
    { type: "text", name: "fairness_flags" },
    { type: "text", name: "talent_pool_signal" },
  ],
  interviewKits: [
    { type: "text", name: "candidate_id" },
    { type: "text", name: "job_id" },
    { type: "text", name: "question_list" },
    { type: "text", name: "scorecard" },
    { type: "text", name: "focus_areas" },
    { type: "text", name: "risk_checks" },
    { type: "text", name: "created_by_agent" },
  ],
  agentRuns: [
    { type: "text", name: "run_id" },
    { type: "select", name: "agent_name", multiple: false, options: [{ name: "hr_coordinator" }, { name: "resume_intake" }, { name: "resume_extraction" }, { name: "screening_reviewer" }, { name: "interview_kit" }, { name: "analytics" }, { name: "graph_builder" }] },
    { type: "select", name: "entity_type", multiple: false, options: [{ name: "job" }, { name: "candidate" }, { name: "evaluation" }, { name: "interview_kit" }, { name: "report" }] },
    { type: "text", name: "entity_ref" },
    { type: "text", name: "input_summary" },
    { type: "text", name: "output_json" },
    { type: "text", name: "prompt_template_id" },
    { type: "text", name: "git_commit_hash" },
    { type: "text", name: "prompt_hash" },
    { type: "select", name: "status_before", multiple: false, options: [{ name: "new" }, { name: "parsed" }, { name: "screened" }, { name: "interview_kit_ready" }, { name: "decision_pending" }, { name: "offer" }, { name: "rejected" }] },
    { type: "select", name: "status_after", multiple: false, options: [{ name: "new" }, { name: "parsed" }, { name: "screened" }, { name: "interview_kit_ready" }, { name: "decision_pending" }, { name: "offer" }, { name: "rejected" }] },
    { type: "select", name: "run_status", multiple: false, options: [{ name: "success" }, { name: "failed" }, { name: "retried" }, { name: "skipped" }] },
    { type: "text", name: "error_message" },
    { type: "number", name: "retry_count", style: { type: "plain", precision: 0 } },
    { type: "number", name: "duration_ms", style: { type: "plain", precision: 0 } },
  ],
  workEvents: [
    { type: "text", name: "event_id" },
    { type: "select", name: "agent_name", multiple: false, options: [{ name: "hr_coordinator" }, { name: "resume_intake" }, { name: "resume_extraction" }, { name: "screening_reviewer" }, { name: "interview_kit" }, { name: "analytics" }, { name: "graph_builder" }] },
    { type: "select", name: "event_type", multiple: false, options: [{ name: "tool_call" }, { name: "status_transition" }, { name: "guard_check" }, { name: "human_action" }] },
    { type: "select", name: "tool_type", multiple: false, options: [{ name: "record_list" }, { name: "record_upsert" }, { name: "llm_call" }, { name: "none" }] },
    { type: "text", name: "target_table" },
    { type: "select", name: "execution_mode", multiple: false, options: [{ name: "dry_run" }, { name: "live_read" }, { name: "live_write" }, { name: "blocked" }] },
    { type: "select", name: "guard_status", multiple: false, options: [{ name: "passed" }, { name: "blocked" }, { name: "skipped" }, { name: "none" }] },
    { type: "text", name: "safe_summary" },
    { type: "text", name: "status_before" },
    { type: "text", name: "status_after" },
    { type: "number", name: "duration_ms", style: { type: "plain", precision: 0 } },
    { type: "text", name: "parent_run_id" },
    { type: "select", name: "link_status", multiple: false, options: [{ name: "has_link" }, { name: "no_link" }, { name: "demo_only" }] },
    { type: "datetime", name: "created_at", style: { format: "yyyy-MM-dd HH:mm" } },
  ],
  reports: [
    { type: "text", name: "report_id" },
    { type: "datetime", name: "period_start", style: { format: "yyyy-MM-dd HH:mm" } },
    { type: "datetime", name: "period_end", style: { format: "yyyy-MM-dd HH:mm" } },
    { type: "text", name: "funnel_summary" },
    { type: "text", name: "quality_summary" },
    { type: "text", name: "bottlenecks" },
    { type: "text", name: "talent_pool_suggestions" },
    { type: "text", name: "recommendations" },
    { type: "text", name: "created_by_agent" },
  ],
};

console.log("Creating tables...");
createTable("Jobs", fields.jobs);
createTable("Candidates", fields.candidates);
createTable("Resume Facts", fields.resumeFacts);
createTable("Evaluations", fields.evaluations);
createTable("Interview Kits", fields.interviewKits);
createTable("Agent Runs", fields.agentRuns);
createTable("Work Events", fields.workEvents);
createTable("Reports", fields.reports);

const jobIndex = loadExistingIndex("Jobs", "job_id");
const candidateIndex = loadExistingIndex("Candidates", "candidate_id");
const resumeFactIndex = loadExistingIndex("Resume Facts", "candidate_id");
const evalIndex = loadExistingIndex("Evaluations", "candidate_id");
const kitIndex = loadExistingIndex("Interview Kits", "candidate_id");
const agentRunIndex = loadExistingIndex("Agent Runs", "run_id");
const workEventIndex = loadExistingIndex("Work Events", "event_id");
const reportIndex = loadExistingIndex("Reports", "report_id");

const jobs = readCsv("jobs.csv");
const profiles = readCsv("candidate_profiles.csv").slice(0, candidateLimit);
const decisions = new Map(readCsv("decision_memory.csv").map((r) => [r.candidate_id, r]));
const resumes = new Map(readCsv("resumes.csv").map((r) => [r.candidate_id, r]));
const features = readCsv("candidate_features.csv");
const edges = readCsv("candidate_similarity_edges.csv").slice(0, edgeLimit);

console.log("Importing Jobs...");
for (const job of jobs) {
  upsertWithKey("Jobs", "job_id", {
    job_id: job.job_id,
    title: job.raw_role_name,
    normalized_role_name: job.normalized_role_name,
    requirements: clip(job.job_description),
    candidate_count: num(job.candidate_count),
    select_count: num(job.select_count),
    reject_count: num(job.reject_count),
    rubric: clip(job.hiring_profile_summary),
    status: "open",
    owner: "HireLoop Demo",
    created_at: now(),
  }, jobIndex);
}

console.log(`Importing ${profiles.length} Candidates + Evaluations + Interview Kits...`);
for (const profile of profiles) {
  const decision = decisions.get(profile.candidate_id) ?? {};
  const resume = resumes.get(profile.candidate_id) ?? {};
  const recommendation = decision.decision_gt === "select" ? "strong_match" : "review_needed";
  const status = decision.decision_gt === "select" ? "decision_pending" : "screened";
  const candidateRecord = {
    candidate_id: profile.candidate_id,
    display_name: profile.candidate_id,
    job_id: profile.job_id,
    resume_id: profile.resume_id,
    resume_text: clip(resume.resume_text ?? resume.Resume ?? profile.structured_summary),
    status,
    screening_recommendation: recommendation,
    talent_pool_candidate: decision.decision_gt === "select",
    human_decision: "none",
    human_decision_by: "",
    human_decision_note: "",
  };
  upsertWithKey("Candidates", "candidate_id", candidateRecord, candidateIndex);
  upsertWithKey("Evaluations", "candidate_id", {
    candidate_id: profile.candidate_id,
    job_id: profile.job_id,
    dimension: "Graph RAG screening",
    rating: decision.decision_gt === "select" ? "strong" : "medium",
    score: num(decision.confidence),
    recommendation,
    reason: clip(decision.reason_gt || profile.structured_summary),
    evidence_refs: profile.resume_id,
    fairness_flags: "none",
    talent_pool_signal: decision.reason_group ?? "",
  }, evalIndex);
  upsertWithKey("Interview Kits", "candidate_id", {
    candidate_id: profile.candidate_id,
    job_id: profile.job_id,
    question_list: "1. 请展开说明最近一个相关项目。\n2. 请说明与目标岗位最匹配的经历。\n3. 请解释一次跨团队协作的结果。",
    scorecard: "技术深度 / 业务匹配 / 沟通表达 / 风险项",
    focus_areas: clip(profile.structured_summary, 800),
    risk_checks: decision.decision_gt === "reject" ? clip(decision.reason_gt, 500) : "确认稳定性、岗位动机和可入职时间。",
    created_by_agent: "interview_kit",
  }, kitIndex);
}

console.log("Importing Resume Facts sample...");
const profileIds = new Set(profiles.map((p) => p.candidate_id));
let factCount = 0;
for (const feature of features) {
  if (factCount >= candidateLimit * 2) break;
  if (!profileIds.has(feature.candidate_id)) continue;
  upsertWithKey("Resume Facts", "candidate_id", {
    candidate_id: feature.candidate_id,
    fact_type: feature.feature_type === "skill" ? "skill" : "other",
    fact_text: clip(`${feature.feature_name || feature.feature_key}: ${feature.feature_value || "present"}`, 800),
    source_excerpt: clip(feature.evidence || "", 800),
    confidence: "high",
    created_by_agent: "resume_extraction",
  }, resumeFactIndex);
  factCount++;
}

console.log("Importing Agent Runs, Work Events, Reports...");
const eventSeed = [
  ["resume_intake", "status_transition", "record_upsert", "Candidates", "dry_run", "passed", "简历录入完成原始简历只读接收并推进解析", "new", "parsed", 118],
  ["resume_extraction", "tool_call", "record_upsert", "Resume Facts", "dry_run", "passed", "信息抽取生成技能、特征与候选人画像", "", "", 129],
  ["graph_builder", "guard_check", "record_upsert", "Agent Runs", "blocked", "blocked", "图谱构建确认当前为只读模式，仅记录相似边计划", "", "", 14],
  ["screening_reviewer", "tool_call", "llm_call", "Evaluations", "dry_run", "skipped", "图谱复核融合角色记忆与相似候选网络", "", "", 88],
  ["interview_kit", "status_transition", "record_upsert", "Interview Kits", "dry_run", "passed", "面试准备生成结构化面试材料", "screened", "interview_kit_ready", 136],
  ["hr_coordinator", "human_action", "none", "Candidates", "dry_run", "none", "HR 协调将候选人推进到待决策节点", "", "decision_pending", 58],
  ["analytics", "tool_call", "record_list", "Reports", "dry_run", "passed", "数据分析生成招聘漏斗摘要", "", "", 102],
] as const;

for (let i = 0; i < eventSeed.length; i++) {
  const [agent, eventType, toolType, table, mode, guard, summary, before, after, duration] = eventSeed[i]!;
  const runId = stableId("RUN", [agent, String(i)]);
  upsertWithKey("Agent Runs", "run_id", {
    run_id: runId,
    agent_name: agent,
    entity_type: table === "Reports" ? "report" : "candidate",
    entity_ref: profiles[0]?.candidate_id ?? "CAN-DEMO",
    input_summary: `只读演示输入：${summary}`,
    output_json: JSON.stringify({ safeSummary: summary }),
    prompt_template_id: `hireloop.${agent}.v1`,
    git_commit_hash: "local-demo",
    prompt_hash: stableId("PROMPT", [agent, summary]),
    status_before: before || undefined,
    status_after: after || undefined,
    run_status: "success",
    error_message: "",
    retry_count: 0,
    duration_ms: duration,
  }, agentRunIndex);
  upsertWithKey("Work Events", "event_id", {
    event_id: stableId("EVT", [agent, String(i), summary]),
    agent_name: agent,
    event_type: eventType,
    tool_type: toolType,
    target_table: table,
    execution_mode: mode,
    guard_status: guard,
    safe_summary: summary,
    status_before: before,
    status_after: after,
    duration_ms: duration,
    parent_run_id: runId,
    link_status: "demo_only",
    created_at: now(),
  }, workEventIndex);
}

upsertWithKey("Reports", "report_id", {
  report_id: stableId("RPT", ["competition-demo", now()]),
  period_start: "2026-05-01 00:00:00",
  period_end: now(),
  funnel_summary: `${profiles.length} 位候选人样本，覆盖 ${jobs.length} 个岗位；服务器镜像全量为 5991 candidates / 23961 evidence。`,
  quality_summary: "Graph RAG 使用候选人画像、决策记忆、相似边与岗位画像生成可解释筛选建议。",
  bottlenecks: "真实飞书权限迁移前，先使用用户自有 Base 验证可复现闭环。",
  talent_pool_suggestions: "优先复核 select_signal 高置信候选人，并保留 review_needed 人才池。",
  recommendations: "现场演示使用只读计划 + 后端双确认边界，避免前端直接写入。",
  created_by_agent: "analytics",
}, reportIndex);

const summary = {
  baseToken: `${baseToken.slice(0, 4)}...${baseToken.slice(-4)}`,
  imported: {
    jobs: jobs.length,
    candidates: profiles.length,
    evaluations: profiles.length,
    interviewKits: profiles.length,
    resumeFacts: factCount,
    agentRuns: eventSeed.length,
    workEvents: eventSeed.length,
    reports: 1,
    sampledEdges: edges.length,
  },
};
writeFileSync("tmp/hireloop-demo-base-import-summary.json", JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
