import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DeterministicLlmClient } from "../llm/deterministic-client.js";
import { runCandidatePipeline, type CandidatePipelineInput, type CandidatePipelineResult } from "../orchestrator/candidate-pipeline.js";
import { readLiveCandidateContext } from "../orchestrator/live-candidate-context.js";
import {
  buildRuntimeDashboardSnapshot,
  writeRuntimeDashboardSnapshot,
  type RuntimeDashboardSnapshot,
} from "./runtime-dashboard.js";

const DEFAULT_QUEUE_PATH = resolve(process.cwd(), "tmp", "deferred-graph-queue.json");
const MAX_ITEMS = 200;
const MAX_PREVIEW_CHARS = 120;

export type DeferredQueueItemKind =
  | "operator_request"
  | "search_query"
  | "candidate_graph_refresh"
  | "candidate_intake";

export type DeferredQueueItemStatus = "pending" | "processed" | "failed";

interface DeferredQueueFile {
  kind: "deferred_graph_queue";
  version: 1;
  updated_at: string;
  items: DeferredQueueStoredItem[];
}

interface DeferredQueueStoredItemBase {
  id: string;
  kind: DeferredQueueItemKind;
  status: DeferredQueueItemStatus;
  created_at: string;
  processed_at: string | null;
  safe_label: string;
  safe_summary: string;
  result_summary: string | null;
}

interface OperatorRequestPayload {
  title: string;
  content: string;
  requested_by: string | null;
}

interface CandidateGraphRefreshPayload {
  link_id: string;
  display_name: string | null;
}

interface SearchQueryPayload {
  query: string;
  result_summary: string | null;
  top_candidate_ids: string[];
}

interface CandidateIntakePayload {
  display_name: string;
  candidate_id: string;
  job_id: string;
  job_title: string;
  resume_text: string;
  job_requirements: string;
  job_rubric: string;
}

interface OperatorRequestItem extends DeferredQueueStoredItemBase {
  kind: "operator_request";
  payload: OperatorRequestPayload;
}

interface CandidateGraphRefreshItem extends DeferredQueueStoredItemBase {
  kind: "candidate_graph_refresh";
  payload: CandidateGraphRefreshPayload;
}

interface SearchQueryItem extends DeferredQueueStoredItemBase {
  kind: "search_query";
  payload: SearchQueryPayload;
}

interface CandidateIntakeItem extends DeferredQueueStoredItemBase {
  kind: "candidate_intake";
  payload: CandidateIntakePayload;
}

type DeferredQueueStoredItem =
  | OperatorRequestItem
  | SearchQueryItem
  | CandidateGraphRefreshItem
  | CandidateIntakeItem;

export interface DeferredQueueItemView {
  id: string;
  kind: DeferredQueueItemKind;
  status: DeferredQueueItemStatus;
  created_at: string;
  processed_at: string | null;
  safe_label: string;
  safe_summary: string;
  result_summary: string | null;
}

export interface DeferredQueueOverview {
  total: number;
  pending: number;
  processed: number;
  failed: number;
  items: DeferredQueueItemView[];
  queue_path_mode: "local_tmp";
}

export interface DeferredEnqueueResult {
  status: "queued";
  item: DeferredQueueItemView;
  pending: number;
  safeSummary: string;
}

export interface DeferredProcessWindow {
  start?: string;
  end?: string;
}

export interface DeferredProcessResult {
  status: "success";
  totalMatched: number;
  processedCount: number;
  failedCount: number;
  requestOnlyCount: number;
  snapshotUpdated: boolean;
  safeSummary: string;
  window: {
    start: string | null;
    end: string | null;
  };
  items: DeferredQueueItemView[];
}

export interface DeferredQueueDeps {
  queuePath?: string;
  now?: () => string;
  readLiveCandidateContext?: typeof readLiveCandidateContext;
  runCandidatePipeline?: (
    client: DeterministicLlmClient,
    input: CandidatePipelineInput,
  ) => Promise<CandidatePipelineResult>;
  writeRuntimeDashboardSnapshot?: (
    snapshot: RuntimeDashboardSnapshot,
    filePath?: string,
  ) => void;
}

export function listDeferredQueue(deps?: DeferredQueueDeps): DeferredQueueOverview {
  const queue = loadQueueFile(deps);
  const items = queue.items.map(toView).sort((a, b) => b.created_at.localeCompare(a.created_at));
  return {
    total: items.length,
    pending: items.filter((item) => item.status === "pending").length,
    processed: items.filter((item) => item.status === "processed").length,
    failed: items.filter((item) => item.status === "failed").length,
    items,
    queue_path_mode: "local_tmp",
  };
}

export function enqueueOperatorRequest(
  input: {
    title: string;
    content: string;
    requestedBy?: string | null;
  },
  deps?: DeferredQueueDeps,
): DeferredEnqueueResult {
  const title = input.title.trim();
  const content = input.content.trim();
  if (!title) {
    throw new Error("title 不能为空");
  }
  if (!content) {
    throw new Error("content 不能为空");
  }

  const queue = loadQueueFile(deps);
  const now = getNow(deps);
  const item: OperatorRequestItem = {
    id: buildQueueId("req", now),
    kind: "operator_request",
    status: "pending",
    created_at: now,
    processed_at: null,
    safe_label: title,
    safe_summary: previewText(content),
    result_summary: null,
    payload: {
      title,
      content,
      requested_by: normalizeOptionalText(input.requestedBy),
    },
  };

  queue.items.unshift(item);
  trimQueue(queue);
  saveQueueFile(queue, deps);

  return {
    status: "queued",
    item: toView(item),
    pending: queue.items.filter((queuedItem) => queuedItem.status === "pending").length,
    safeSummary: "需求已暂存，当前不会触发图更新。",
  };
}

export function enqueueSearchQuery(
  input: {
    query: string;
    resultSummary?: string | null;
    topCandidateIds?: string[];
  },
  deps?: DeferredQueueDeps,
): DeferredEnqueueResult {
  const query = input.query.trim();
  if (!query) {
    throw new Error("query 不能为空");
  }

  const queue = loadQueueFile(deps);
  const now = getNow(deps);
  const latest = queue.items[0];
  if (latest && latest.kind === "search_query" && latest.payload.query === query) {
    latest.created_at = now;
    latest.safe_summary = normalizeOptionalText(input.resultSummary) ?? "检索查询已自动保存。";
    latest.payload.result_summary = normalizeOptionalText(input.resultSummary);
    latest.payload.top_candidate_ids = input.topCandidateIds?.slice(0, 5) ?? [];
    latest.status = "pending";
    latest.processed_at = null;
    latest.result_summary = null;
    saveQueueFile(queue, deps);
    return {
      status: "queued",
      item: toView(latest),
      pending: queue.items.filter((queuedItem) => queuedItem.status === "pending").length,
      safeSummary: "检索查询已更新到历史记录。",
    };
  }

  const item: SearchQueryItem = {
    id: buildQueueId("query", now),
    kind: "search_query",
    status: "pending",
    created_at: now,
    processed_at: null,
    safe_label: previewText(query),
    safe_summary: normalizeOptionalText(input.resultSummary) ?? "检索查询已自动保存。",
    result_summary: null,
    payload: {
      query,
      result_summary: normalizeOptionalText(input.resultSummary),
      top_candidate_ids: input.topCandidateIds?.slice(0, 5) ?? [],
    },
  };

  queue.items.unshift(item);
  trimQueue(queue);
  saveQueueFile(queue, deps);

  return {
    status: "queued",
    item: toView(item),
    pending: queue.items.filter((queuedItem) => queuedItem.status === "pending").length,
    safeSummary: "检索查询已自动保存。",
  };
}

export function enqueueCandidateIntake(
  input: {
    displayName: string;
    candidateId?: string | null;
    jobId?: string | null;
    jobTitle: string;
    resumeText: string;
    jobRequirements: string;
    jobRubric?: string | null;
  },
  deps?: DeferredQueueDeps,
): DeferredEnqueueResult {
  const displayName = input.displayName.trim();
  const jobTitle = input.jobTitle.trim();
  const resumeText = input.resumeText.trim();
  const jobRequirements = input.jobRequirements.trim();
  const jobRubric = input.jobRubric?.trim() || jobRequirements;

  if (!displayName) {
    throw new Error("displayName 不能为空");
  }
  if (!jobTitle) {
    throw new Error("jobTitle 不能为空");
  }
  if (!resumeText) {
    throw new Error("resumeText 不能为空");
  }
  if (!jobRequirements) {
    throw new Error("jobRequirements 不能为空");
  }

  const queue = loadQueueFile(deps);
  const now = getNow(deps);
  const itemId = buildQueueId("intake", now);
  const item: CandidateIntakeItem = {
    id: itemId,
    kind: "candidate_intake",
    status: "pending",
    created_at: now,
    processed_at: null,
    safe_label: displayName,
    safe_summary: `候选人暂存：${displayName} / ${jobTitle}，已保存，等待集中建图。`,
    result_summary: null,
    payload: {
      display_name: displayName,
      candidate_id: input.candidateId?.trim() || `cand_async_${itemId}`,
      job_id: input.jobId?.trim() || `job_async_${itemId}`,
      job_title: jobTitle,
      resume_text: resumeText,
      job_requirements: jobRequirements,
      job_rubric: jobRubric,
    },
  };

  queue.items.unshift(item);
  trimQueue(queue);
  saveQueueFile(queue, deps);

  return {
    status: "queued",
    item: toView(item),
    pending: queue.items.filter((queuedItem) => queuedItem.status === "pending").length,
    safeSummary: "候选人已暂存，当前不会触发图更新。",
  };
}

export function enqueueCandidateGraphRefresh(
  input: {
    linkId: string;
    displayName?: string | null;
  },
  deps?: DeferredQueueDeps,
): DeferredEnqueueResult {
  const linkId = input.linkId.trim();
  if (!linkId) {
    throw new Error("linkId 不能为空");
  }

  const queue = loadQueueFile(deps);
  const now = getNow(deps);
  const displayName = normalizeOptionalText(input.displayName) ?? "候选人";
  const item: CandidateGraphRefreshItem = {
    id: buildQueueId("graph", now),
    kind: "candidate_graph_refresh",
    status: "pending",
    created_at: now,
    processed_at: null,
    safe_label: displayName,
    safe_summary: `候选人 ${displayName} 已入队，图更新延后到批处理阶段。`,
    result_summary: null,
    payload: {
      link_id: linkId,
      display_name: normalizeOptionalText(input.displayName),
    },
  };

  queue.items.unshift(item);
  trimQueue(queue);
  saveQueueFile(queue, deps);

  return {
    status: "queued",
    item: toView(item),
    pending: queue.items.filter((queuedItem) => queuedItem.status === "pending").length,
    safeSummary: "候选人已加入异步图更新队列。",
  };
}

export async function processDeferredQueue(
  window: DeferredProcessWindow,
  deps?: DeferredQueueDeps,
): Promise<DeferredProcessResult> {
  const queue = loadQueueFile(deps);
  const startTime = parseOptionalDate(window.start);
  const endTime = parseOptionalDate(window.end);

  const matched = queue.items.filter((item) => {
    if (item.status !== "pending") {
      return false;
    }
    const createdAt = Date.parse(item.created_at);
    if (!Number.isFinite(createdAt)) {
      return false;
    }
    if (startTime !== null && createdAt < startTime) {
      return false;
    }
    if (endTime !== null && createdAt > endTime) {
      return false;
    }
    return true;
  });

  let processedCount = 0;
  let failedCount = 0;
  let requestOnlyCount = 0;
  let snapshotUpdated = false;
  let latestSnapshot: RuntimeDashboardSnapshot | null = null;

  for (const item of matched) {
    if (item.kind === "operator_request" || item.kind === "search_query") {
      item.status = "processed";
      item.processed_at = getNow(deps);
      item.result_summary = item.kind === "search_query"
        ? "查询历史已归档，本次同步未触发图更新。"
        : "需求已归档，当前批处理未触发图更新。";
      processedCount += 1;
      requestOnlyCount += 1;
      continue;
    }

    try {
      const pipelineResult = await processQueueCandidateItem(item, deps);
      item.status = pipelineResult.completed ? "processed" : "failed";
      item.processed_at = getNow(deps);
      item.result_summary = pipelineResult.completed
        ? `批处理完成：状态推进到 ${pipelineResult.finalStatus}。`
        : `批处理失败：${pipelineResult.failedAgent ?? "unknown_agent"} 阶段未完成。`;
      if (item.status === "processed") {
        processedCount += 1;
      } else {
        failedCount += 1;
      }

      latestSnapshot = buildRuntimeDashboardSnapshot(pipelineResult, {
        source: "deterministic",
        externalModelCalls: false,
      });
    } catch {
      item.status = "failed";
      item.processed_at = getNow(deps);
      item.result_summary = "批处理失败，请检查输入数据或飞书只读状态。";
      failedCount += 1;
    }
  }

  if (latestSnapshot) {
    const writer = deps?.writeRuntimeDashboardSnapshot ?? writeRuntimeDashboardSnapshot;
    writer(latestSnapshot);
    snapshotUpdated = true;
  }

  saveQueueFile(queue, deps);

  return {
    status: "success",
    totalMatched: matched.length,
    processedCount,
    failedCount,
    requestOnlyCount,
    snapshotUpdated,
    safeSummary: matched.length === 0
      ? "当前时间窗口内没有待处理数据。"
      : `批处理完成：共匹配 ${matched.length} 条，成功 ${processedCount} 条，失败 ${failedCount} 条。`,
    window: {
      start: normalizeOptionalText(window.start),
      end: normalizeOptionalText(window.end),
    },
    items: matched.map(toView),
  };
}

async function processQueueCandidateItem(
  item: CandidateGraphRefreshItem | CandidateIntakeItem,
  deps?: DeferredQueueDeps,
): Promise<CandidatePipelineResult> {
  const runner = deps?.runCandidatePipeline ?? runCandidatePipeline;
  const client = new DeterministicLlmClient();
  if (item.kind === "candidate_intake") {
    return runner(client, {
      candidateRecordId: `rec_async_candidate_${item.id}`,
      jobRecordId: `rec_async_job_${item.id}`,
      candidateId: item.payload.candidate_id,
      jobId: item.payload.job_id,
      resumeText: item.payload.resume_text,
      jobRequirements: item.payload.job_requirements,
      jobRubric: item.payload.job_rubric,
    });
  }

  const contextReader = deps?.readLiveCandidateContext ?? readLiveCandidateContext;
  const ctx = await contextReader(item.payload.link_id, { requireJob: true, requireResume: true });
  if (ctx.status !== "ok") {
    throw new Error(ctx.safeSummary);
  }

  return runner(client, {
    candidateRecordId: ctx.context.candidateRecordId,
    jobRecordId: ctx.context.jobRecordId!,
    candidateId: ctx.context.candidateId,
    jobId: ctx.context.jobId!,
    resumeText: ctx.context.resumeText!,
    jobRequirements: ctx.context.jobRequirements!,
    jobRubric: ctx.context.jobRubric!,
  });
}

function getQueuePath(deps?: DeferredQueueDeps): string {
  return deps?.queuePath ?? DEFAULT_QUEUE_PATH;
}

function getNow(deps?: DeferredQueueDeps): string {
  return deps?.now?.() ?? new Date().toISOString();
}

function loadQueueFile(deps?: DeferredQueueDeps): DeferredQueueFile {
  const filePath = getQueuePath(deps);
  if (!existsSync(filePath)) {
    return {
      kind: "deferred_graph_queue",
      version: 1,
      updated_at: getNow(deps),
      items: [],
    };
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    if (isQueueFile(parsed)) {
      return parsed;
    }
  } catch {
    // ignore invalid file and reset
  }

  return {
    kind: "deferred_graph_queue",
    version: 1,
    updated_at: getNow(deps),
    items: [],
  };
}

function saveQueueFile(queue: DeferredQueueFile, deps?: DeferredQueueDeps): void {
  const filePath = getQueuePath(deps);
  queue.updated_at = getNow(deps);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(queue, null, 2), "utf8");
}

function trimQueue(queue: DeferredQueueFile): void {
  if (queue.items.length <= MAX_ITEMS) {
    return;
  }
  queue.items = queue.items.slice(0, MAX_ITEMS);
}

function isQueueFile(value: unknown): value is DeferredQueueFile {
  if (!value || typeof value !== "object") {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return obj.kind === "deferred_graph_queue" && obj.version === 1 && Array.isArray(obj.items);
}

function buildQueueId(prefix: string, now: string): string {
  return `${prefix}_${now.replace(/[^0-9]/g, "").slice(0, 14)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function previewText(value: string): string {
  return value.length <= MAX_PREVIEW_CHARS ? value : `${value.slice(0, MAX_PREVIEW_CHARS)}...`;
}

function parseOptionalDate(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function toView(item: DeferredQueueStoredItem): DeferredQueueItemView {
  return {
    id: item.id,
    kind: item.kind,
    status: item.status,
    created_at: item.created_at,
    processed_at: item.processed_at,
    safe_label: item.safe_label,
    safe_summary: item.safe_summary,
    result_summary: item.result_summary,
  };
}
