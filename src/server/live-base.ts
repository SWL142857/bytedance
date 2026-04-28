import { spawnSync } from "node:child_process";
import { loadConfig, type HireLoopConfig } from "../config.js";
import { runReadOnlyCommands, type CommandExecutor } from "../base/read-only-runner.js";
import { buildListRecordsCommand, type ListOptions } from "../base/queries.js";
import { parseRecordList } from "../base/lark-cli-runner.js";
import type { SafeWorkEventView, WorkEventExecutionMode, WorkEventGuardStatus, WorkEventToolType, WorkEventType } from "../types/work-event.js";
import { redactSafeText } from "./redaction.js";
import { getLiveLinkRegistry } from "./live-link-registry.js";

// ── Types ──

export interface LiveBaseStatus {
  cliAvailable: boolean;
  larkEnvComplete: boolean;
  readEnabled: boolean;
  writeDisabled: boolean;
  blockedReasons: string[];
}

export interface SafeLiveCandidate {
  link: SafeLiveLink | null;
  display_name: string;
  status: string;
  screening_recommendation: string | null;
  human_decision: string | null;
  job_display: string | null;
  resume_available: boolean;
  updated_at: string | null;
}

export interface SafeLiveJob {
  link: SafeLiveLink | null;
  title: string;
  department: string;
  level: string;
  status: string;
  owner: string;
}

export interface SafeLiveLink {
  link_id: string;
  link_label?: string;
  unavailable_label?: string | null;
  available: boolean;
}

export interface LiveRecordsResult<T> {
  records: T[];
  total: number;
}

// ── Dependencies (injectable) ──

export interface LiveBaseDeps {
  loadConfig?: () => HireLoopConfig;
  executor?: CommandExecutor;
  cliAvailable?: () => boolean;
}

interface RawLiveRecord {
  id: string;
  fields: Record<string, unknown>;
}

// ── Status ──

export function getLiveBaseStatus(deps?: LiveBaseDeps): LiveBaseStatus {
  const configFn = deps?.loadConfig ?? loadConfig;
  const config = configFn();
  const cliAvailable = deps?.cliAvailable ? deps.cliAvailable() : isLarkCliAvailable();

  const blockedReasons: string[] = [];

  if (!cliAvailable) {
    blockedReasons.push("lark-cli 未安装或不可用");
  }
  if (!config.allowLarkRead) {
    blockedReasons.push("HIRELOOP_ALLOW_LARK_READ is not enabled");
  }
  if (!config.larkAppId) {
    blockedReasons.push("飞书应用 ID 未配置");
  }
  if (!config.larkAppSecret) {
    blockedReasons.push("飞书应用密钥未配置");
  }
  if (!config.baseAppToken) {
    blockedReasons.push("Base 应用凭证未配置");
  }

  return {
    cliAvailable,
    larkEnvComplete: !!(config.larkAppId && config.larkAppSecret && config.baseAppToken),
    readEnabled: config.allowLarkRead,
    writeDisabled: !config.allowLarkWrite,
    blockedReasons,
  };
}

function isLarkCliAvailable(): boolean {
  try {
    const result = spawnSync("lark-cli", ["--version"], {
      timeout: 3000,
      encoding: "utf-8",
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

// ── Helpers ──

function extractField(raw: Record<string, unknown>, fieldName: string): string | null {
  const val = raw[fieldName];
  if (typeof val === "string" && val.length > 0) return redactSafeText(val);
  if (Array.isArray(val) && typeof val[0] === "object" && val[0] !== null) {
    const obj = val[0] as Record<string, unknown>;
    return typeof obj.text === "string" ? redactSafeText(obj.text) : null;
  }
  return null;
}

function extractSelectField(raw: Record<string, unknown>, fieldName: string): string | null {
  const val = raw[fieldName];
  if (typeof val === "string") return redactSafeText(val);
  if (Array.isArray(val)) {
    const first = val[0];
    if (typeof first === "string") return redactSafeText(first);
    if (typeof first === "object" && first !== null) {
      const obj = first as Record<string, unknown>;
      return typeof obj.text === "string" ? redactSafeText(obj.text) : null;
    }
    return redactSafeText(String(first ?? ""));
  }
  if (typeof val === "object" && val !== null) {
    const obj = val as Record<string, unknown>;
    return typeof obj.text === "string" ? redactSafeText(obj.text) : null;
  }
  return null;
}

// ── Candidate projection ──

function projectCandidate(record: RawLiveRecord): SafeLiveCandidate {
  const raw = record.fields;
  const displayName = extractField(raw, "display_name") ?? "未知候选人";

  let link: SafeLiveLink | null = null;
  if (record.id) {
    const linkId = getLiveLinkRegistry().register("candidates", record.id);
    link = { link_id: linkId, link_label: "打开飞书", available: true, unavailable_label: null };
  }

  return {
    link,
    display_name: displayName,
    status: extractSelectField(raw, "status") ?? "new",
    screening_recommendation: extractSelectField(raw, "screening_recommendation"),
    human_decision: extractSelectField(raw, "human_decision"),
    job_display: extractField(raw, "job"),
    resume_available: !!extractField(raw, "resume_text"),
    updated_at: extractField(raw, "updated_at") ?? extractField(raw, "created_at"),
  };
}

// ── Job projection ──

function projectJob(record: RawLiveRecord): SafeLiveJob {
  const raw = record.fields;
  let link: SafeLiveLink | null = null;
  if (record.id) {
    const linkId = getLiveLinkRegistry().register("jobs", record.id);
    link = { link_id: linkId, link_label: "打开飞书", available: true, unavailable_label: null };
  }

  return {
    link,
    title: extractField(raw, "title") ?? "未知岗位",
    department: extractField(raw, "department") ?? "",
    level: extractField(raw, "level") ?? "",
    status: extractSelectField(raw, "status") ?? "open",
    owner: extractField(raw, "owner") ?? "",
  };
}

// ── Record listing ──

function normalizeEventType(value: string | null): WorkEventType {
  switch (value) {
    case "tool_call":
    case "status_transition":
    case "guard_check":
    case "retry":
    case "error":
    case "human_action":
      return value;
    default:
      return "tool_call";
  }
}

function normalizeToolType(value: string | null): Exclude<WorkEventToolType, null> | null {
  switch (value) {
    case "record_list":
    case "record_upsert":
    case "table_create":
    case "llm_call":
      return value;
    default:
      return null;
  }
}

function normalizeExecutionMode(value: string | null): WorkEventExecutionMode {
  switch (value) {
    case "dry_run":
    case "live_read":
    case "live_write":
    case "blocked":
      return value;
    default:
      return "live_read";
  }
}

function normalizeGuardStatus(value: string | null): WorkEventGuardStatus {
  switch (value) {
    case "passed":
    case "blocked":
    case "skipped":
      return value;
    default:
      return null;
  }
}

function projectWorkEvent(record: RawLiveRecord): SafeWorkEventView {
  const raw = record.fields;
  const linkId = record.id ? getLiveLinkRegistry().register("work_events", record.id) : null;
  return {
    agent_name: extractField(raw, "agent_name") ?? "未知角色",
    event_type: normalizeEventType(extractSelectField(raw, "event_type")),
    tool_type: normalizeToolType(extractSelectField(raw, "tool_type")),
    target_table: extractField(raw, "target_table"),
    execution_mode: normalizeExecutionMode(extractSelectField(raw, "execution_mode")),
    guard_status: normalizeGuardStatus(extractSelectField(raw, "guard_status")),
    safe_summary: extractField(raw, "safe_summary") ?? "",
    status_before: extractField(raw, "status_before"),
    status_after: extractField(raw, "status_after"),
    duration_ms: Number(raw.duration_ms) || 0,
    link: linkId
      ? { link_id: linkId, link_label: "打开飞书", link_type: "work_event", available: true, unavailable_label: null }
      : null,
    created_at: extractField(raw, "created_at") ?? "",
  };
}

const ALLOWED_TABLES = ["candidates", "jobs", "work_events"] as const;
type AllowedTable = typeof ALLOWED_TABLES[number];

function isValidTable(table: string): table is AllowedTable {
  return ALLOWED_TABLES.includes(table as AllowedTable);
}

function parseRecordListOutput(stdout: string): RawLiveRecord[] {
  try {
    return parseRecordList(stdout).records;
  } catch {
    try {
      const parsed = JSON.parse(stdout);
      if (parsed && Array.isArray(parsed.records)) {
        return parsed.records.map((record: unknown) => {
          const obj = typeof record === "object" && record !== null ? record as Record<string, unknown> : {};
          const recordId = obj.id ?? obj.record_id;
          return {
            id: typeof recordId === "string" ? recordId : "",
            fields: obj.fields && typeof obj.fields === "object" && !Array.isArray(obj.fields)
              ? obj.fields as Record<string, unknown>
              : obj,
          };
        });
      }
    } catch {
      // fall through
    }
  }
  return [];
}

export async function listLiveRecords<T>(
  table: string,
  options?: ListOptions & { deps?: LiveBaseDeps },
): Promise<LiveRecordsResult<T>> {
  const deps = options?.deps;
  const configFn = deps?.loadConfig ?? loadConfig;
  const config = configFn();

  const status = getLiveBaseStatus(deps);
  if (status.blockedReasons.length > 0) {
    return { records: [], total: 0 };
  }

  if (!isValidTable(table)) {
    return { records: [], total: 0 };
  }

  const cmd = buildListRecordsCommand(table, options);
  const result = runReadOnlyCommands({
    commands: [cmd],
    config,
    execute: true,
    executor: deps?.executor,
  });

  if (result.blocked) return { records: [], total: 0 };

  const cmdResult = result.results[0];
  if (!cmdResult || cmdResult.status !== "success" || !cmdResult.stdout) {
    return { records: [], total: 0 };
  }

  const rawRecords = parseRecordListOutput(cmdResult.stdout);

  const projected = rawRecords.map((r) => {
    switch (table) {
      case "candidates":
        return projectCandidate(r) as unknown as T;
      case "jobs":
        return projectJob(r) as unknown as T;
      case "work_events":
        return projectWorkEvent(r) as unknown as T;
      default:
        return null as unknown as T;
    }
  }).filter((r) => r !== null);

  return { records: projected, total: projected.length };
}
