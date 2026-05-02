import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { CandidateStatus } from "../types/state.js";
import type { CandidatePipelineResult } from "../orchestrator/candidate-pipeline.js";
import type { SafePipelineView } from "./redaction.js";
import { redactPipelineResult, containsSensitivePattern } from "./redaction.js";
import type { OrgOverviewAgentView, OrgOverviewView, SafeWorkEventView } from "../types/work-event.js";
import type { SnapshotSource } from "../types/work-event.js";

const PIPELINE_STAGES: Array<{ key: CandidateStatus; label: string }> = [
  { key: "new", label: "新增" },
  { key: "parsed", label: "已解析" },
  { key: "screened", label: "已筛选" },
  { key: "interview_kit_ready", label: "面试就绪" },
  { key: "decision_pending", label: "待决策" },
];

const AGENT_LABELS = {
  hr_coordinator: "HR 协调",
  resume_intake: "简历录入",
  resume_extraction: "信息抽取",
  graph_builder: "图谱构建",
  screening_reviewer: "图谱复核",
  interview_kit: "面试准备",
  analytics: "数据分析",
  resume_parser: "简历解析",
  screening: "初筛评估",
} as const;

const AGENT_ROLES: Record<string, string> = {
  "HR 协调": "流程协调",
  "简历录入": "原始简历入库",
  "信息抽取": "结构化提取",
  "图谱构建": "候选人相似关系",
  "图谱复核": "图谱辅助评审",
  "简历解析": "信息提取",
  "初筛评估": "匹配评估",
  "面试准备": "面试材料",
  "数据分析": "运行分析",
};

const AGENT_TARGET_TABLES: Record<string, string | null> = {
  hr_coordinator: "candidates",
  resume_intake: "candidates",
  resume_extraction: "resume_facts",
  graph_builder: "agent_runs",
  screening_reviewer: "evaluations",
  interview_kit: "interview_kits",
  analytics: "reports",
  resume_parser: "resume_facts",
  screening: "evaluations",
};

export const DEFAULT_RUNTIME_SNAPSHOT_PATH = resolve(process.cwd(), "tmp", "latest-agent-runtime.json");

export type RuntimeSnapshotSource = "deterministic" | "provider";

export interface RuntimeDashboardSnapshot {
  kind: "runtime_dashboard_snapshot";
  version: 1;
  generated_at: string;
  source: RuntimeSnapshotSource;
  pipeline: SafePipelineView;
  work_events: SafeWorkEventView[];
  org_overview: OrgOverviewView;
}

export interface BuildRuntimeSnapshotOptions {
  generatedAt?: string;
  source: RuntimeSnapshotSource;
  externalModelCalls: boolean;
}

export function buildRuntimeDashboardSnapshot(
  result: CandidatePipelineResult,
  options: BuildRuntimeSnapshotOptions,
): RuntimeDashboardSnapshot {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const pipeline = redactPipelineResult(result);
  const workEvents = buildWorkEventsFromPipeline(result, generatedAt, options.externalModelCalls);
  const orgOverview = buildOrgOverviewFromRuntime(pipeline, workEvents, options.externalModelCalls, options.source, generatedAt);

  return {
    kind: "runtime_dashboard_snapshot",
    version: 1,
    generated_at: generatedAt,
    source: options.source,
    pipeline,
    work_events: workEvents,
    org_overview: orgOverview,
  };
}

export function writeRuntimeDashboardSnapshot(
  snapshot: RuntimeDashboardSnapshot,
  filePath: string = DEFAULT_RUNTIME_SNAPSHOT_PATH,
): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(snapshot, null, 2));
}

export function loadRuntimeDashboardSnapshot(
  filePath: string | null | undefined = DEFAULT_RUNTIME_SNAPSHOT_PATH,
): RuntimeDashboardSnapshot | null {
  if (!filePath || !existsSync(filePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    if (!isRuntimeDashboardSnapshot(parsed)) {
      return null;
    }
    if (!isSafeRuntimeDashboardSnapshot(parsed)) {
      return null;
    }
    normalizeLegacySnapshot(parsed);
    return parsed;
  } catch {
    return null;
  }
}

function buildWorkEventsFromPipeline(
  result: CandidatePipelineResult,
  generatedAt: string,
  externalModelCalls: boolean,
): SafeWorkEventView[] {
  const endTime = Date.parse(generatedAt);
  const executionMode = externalModelCalls ? "live_read" : "dry_run";
  const runEvents = result.agentRuns.map((run, index) => {
    const createdAt = new Date(endTime - (result.agentRuns.length - index) * 60_000).toISOString();
    const eventType = mapRunEventType(run.run_status, run.retry_count, run.status_before, run.status_after);
    const agentName = AGENT_LABELS[run.agent_name as keyof typeof AGENT_LABELS] ?? "未知角色";

    return {
      agent_name: agentName,
      event_type: eventType,
      tool_type: "llm_call",
      target_table: AGENT_TARGET_TABLES[run.agent_name] ?? null,
      execution_mode: executionMode,
      guard_status: "skipped",
      safe_summary: buildAgentSummary(agentName, run.run_status, run.status_after ?? null, run.retry_count),
      status_before: run.status_before ?? null,
      status_after: run.status_after ?? null,
      duration_ms: run.duration_ms,
      link: null,
      created_at: createdAt,
    } satisfies SafeWorkEventView;
  });

  const analyticsEvent: SafeWorkEventView = {
    agent_name: AGENT_LABELS.analytics,
    event_type: "tool_call",
    tool_type: "record_list",
    target_table: AGENT_TARGET_TABLES.analytics ?? null,
    execution_mode: executionMode,
    guard_status: "skipped",
    safe_summary: buildAnalyticsSummary(result),
    status_before: null,
    status_after: result.finalStatus,
    duration_ms: 0,
    link: null,
    created_at: generatedAt,
  };

  return [analyticsEvent, ...runEvents].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function buildOrgOverviewFromRuntime(
  pipeline: SafePipelineView,
  events: SafeWorkEventView[],
  externalModelCalls: boolean,
  snapshotSource: SnapshotSource,
  generatedAt: string,
): OrgOverviewView {
  const latestByAgent = new Map<string, SafeWorkEventView>();
  for (const event of events) {
    if (!latestByAgent.has(event.agent_name)) {
      latestByAgent.set(event.agent_name, event);
    }
  }

  const agents: OrgOverviewAgentView[] = [
    buildAgentOverview("HR 协调", latestByAgent.get("HR 协调") ?? null),
    buildAgentOverview("简历录入", latestByAgent.get("简历录入") ?? null),
    buildAgentOverview("信息抽取", latestByAgent.get("信息抽取") ?? latestByAgent.get("简历解析") ?? null),
    buildAgentOverview("图谱构建", latestByAgent.get("图谱构建") ?? null),
    buildAgentOverview("图谱复核", latestByAgent.get("图谱复核") ?? latestByAgent.get("初筛评估") ?? null),
    buildAgentOverview("面试准备", latestByAgent.get("面试准备") ?? null),
    buildAgentOverview("数据分析", latestByAgent.get("数据分析") ?? null),
  ];

  return {
    agents,
    pipeline: {
      final_status: pipeline.finalStatus,
      completed: pipeline.completed,
      command_count: pipeline.commandCount,
      stage_counts: buildStageCounts(pipeline.finalStatus),
    },
    recent_events: events.slice(0, 6),
    safety: {
      read_only: true,
      real_writes: false,
      external_model_calls: externalModelCalls,
      demo_mode: false,
    },
    data_source: {
      mode: "runtime_snapshot",
      snapshot_source: snapshotSource,
      label: snapshotSource === "deterministic" ? "本地运行快照" : "模型运行快照",
      generated_at: generatedAt,
      external_model_calls: externalModelCalls,
      real_writes: false,
    },
  };
}

function buildAgentOverview(agentName: string, event: SafeWorkEventView | null): OrgOverviewAgentView {
  return {
    agent_name: agentName,
    role_label: AGENT_ROLES[agentName] ?? "流程节点",
    status: determineAgentStatus(event),
    last_event_summary: event?.safe_summary ?? "暂无活动",
    duration_ms: event?.duration_ms ?? null,
  };
}

function determineAgentStatus(event: SafeWorkEventView | null): OrgOverviewAgentView["status"] {
  if (!event) {
    return "空闲";
  }
  if (event.event_type === "human_action") {
    return "需要人工处理";
  }
  if (event.event_type === "error" || event.execution_mode === "blocked" || event.guard_status === "blocked") {
    return "阻塞";
  }
  return "工作中";
}

function mapRunEventType(
  runStatus: string,
  retryCount: number,
  statusBefore: string | undefined,
  statusAfter: string | undefined,
): SafeWorkEventView["event_type"] {
  if (runStatus === "failed") {
    return "error";
  }
  if (runStatus === "retried" || retryCount > 0) {
    return "retry";
  }
  if (statusBefore && statusAfter && statusBefore !== statusAfter) {
    return "status_transition";
  }
  return "tool_call";
}

function buildAgentSummary(
  agentName: string,
  runStatus: string,
  statusAfter: string | null,
  retryCount: number,
): string {
  const stageLabel = mapStatusLabel(statusAfter);
  if (runStatus === "failed") {
    return `${agentName}执行失败，当前停留在${stageLabel}`;
  }
  if (runStatus === "retried" || retryCount > 0) {
    return `${agentName}在重试后完成处理，当前进入${stageLabel}`;
  }
  return `${agentName}完成处理，当前进入${stageLabel}`;
}

function buildAnalyticsSummary(result: CandidatePipelineResult): string {
  if (result.completed) {
    return `数据分析汇总本次流程：共执行 ${result.agentRuns.length} 个智能节点，生成 ${result.commands.length} 条计划命令`;
  }
  return `数据分析记录本次流程中断：已执行 ${result.agentRuns.length} 个智能节点，阻塞于 ${mapFailedAgent(result.failedAgent ?? null)}`;
}

function buildStageCounts(finalStatus: string): Array<{ label: string; count: number }> {
  const known = PIPELINE_STAGES.some((s) => s.key === finalStatus);
  return PIPELINE_STAGES.map((stage) => ({
    label: stage.label,
    count: known && stage.key === finalStatus ? 1 : 0,
  }));
}

function mapStatusLabel(status: string | null): string {
  switch (status) {
    case "new":
      return "新增";
    case "parsed":
      return "已解析";
    case "screened":
      return "已筛选";
    case "interview_kit_ready":
      return "面试就绪";
    case "decision_pending":
      return "待决策";
    default:
      return "当前阶段";
  }
}

function mapFailedAgent(agent: string | null): string {
  switch (agent) {
    case "resume_intake":
      return "简历录入";
    case "resume_extraction":
      return "信息抽取";
    case "graph_builder":
      return "图谱构建";
    case "screening_reviewer":
      return "图谱复核";
    case "resume_parser":
      return "简历解析";
    case "screening":
      return "初筛评估";
    case "interview_kit":
      return "面试准备";
    case "hr_coordinator":
      return "HR 协调";
    default:
      return "未知节点";
  }
}

function isRuntimeDashboardSnapshot(value: unknown): value is RuntimeDashboardSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    record.kind === "runtime_dashboard_snapshot" &&
    record.version === 1 &&
    typeof record.generated_at === "string" &&
    (record.source === "deterministic" || record.source === "provider") &&
    typeof record.pipeline === "object" &&
    record.pipeline !== null &&
    Array.isArray(record.work_events) &&
    typeof record.org_overview === "object" &&
    record.org_overview !== null
  );
}

function normalizeLegacySnapshot(snapshot: RuntimeDashboardSnapshot): void {
  const overview = snapshot.org_overview as unknown as Record<string, unknown>;
  if (overview.data_source) {
    return;
  }

  const source = snapshot.source as SnapshotSource;
  const safety = overview.safety as Record<string, unknown> | undefined;
  const externalModelCalls = !!(safety && safety.external_model_calls);
  overview.data_source = {
    mode: "runtime_snapshot",
    snapshot_source: source,
    label: source === "deterministic" ? "本地运行快照" : "模型运行快照",
    generated_at: snapshot.generated_at,
    external_model_calls: externalModelCalls,
    real_writes: false,
  };
}

const FORBIDDEN_SNAPSHOT_KEYS: ReadonlySet<string> = new Set([
  "record_id", "recordId",
  "run_id", "runId",
  "parent_run_id",
  "base_app_token", "table_id",
  "payload", "prompt",
  "raw", "raw_response", "raw_stdout", "raw_stderr", "stdout", "stderr",
  "authorization",
  "apiKey", "api_key",
  "endpoint",
  "modelId", "model_id",
  "resumeText", "resume_text",
  "jobRequirements", "jobRubric",
  "args", "redactedArgs",
]);

function isSafeRuntimeDashboardSnapshot(value: unknown): boolean {
  try {
    return !hasForbiddenKey(value, 0) && !hasForbiddenStringValue(value, 0);
  } catch {
    return false;
  }
}

const MAX_SCAN_DEPTH = 8;

function hasForbiddenKey(value: unknown, depth: number): boolean {
  if (depth > MAX_SCAN_DEPTH) {
    return true;
  }
  if (value == null) {
    return false;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (hasForbiddenKey(item, depth + 1)) {
        return true;
      }
    }
    return false;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (FORBIDDEN_SNAPSHOT_KEYS.has(key)) {
        return true;
      }
      if (hasForbiddenKey(record[key], depth + 1)) {
        return true;
      }
    }
  }
  return false;
}

function hasForbiddenStringValue(value: unknown, depth: number): boolean {
  if (depth > MAX_SCAN_DEPTH) {
    return true;
  }
  if (value == null) {
    return false;
  }
  if (typeof value === "string") {
    return containsSensitivePattern(value);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (hasForbiddenStringValue(item, depth + 1)) {
        return true;
      }
    }
    return false;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const val of Object.values(record)) {
      if (hasForbiddenStringValue(val, depth + 1)) {
        return true;
      }
    }
  }
  return false;
}
