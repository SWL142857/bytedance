import type { AgentRunRecord } from "../base/runtime.js";
import type { BaseCommandSpec } from "../base/commands.js";
import { ALL_TABLES } from "../base/schema.js";
import type { CandidatePipelineResult } from "../orchestrator/candidate-pipeline.js";
import type { MvpReleaseGateReport } from "../orchestrator/mvp-release-gate.js";
import type { ApiBoundaryAuditReport } from "../orchestrator/api-boundary-release-audit.js";
import type { ProviderAdapterReadiness } from "../llm/provider-adapter.js";
import type { ProviderAgentDemoResult } from "../llm/provider-agent-demo-runner.js";
import type { ProviderSmokeResult } from "../llm/provider-smoke-runner.js";
import type { PreApiFreezeReport } from "../orchestrator/pre-api-freeze-report.js";
import type { LiveReadinessReport } from "../orchestrator/live-readiness-report.js";
import type {
  SafeLinkView,
  SafeWorkEventView,
  WorkEvent,
  WorkEventExecutionMode,
  WorkEventGuardStatus,
  WorkEventLinkType,
  WorkEventToolType,
  WorkEventType,
} from "../types/work-event.js";

export interface SafeAgentRunView {
  agent_name: string;
  entity_type: string;
  entity_ref: string;
  input_summary: string;
  run_status: string;
  status_before: string | null;
  status_after: string | null;
  retry_count: number;
  duration_ms: number;
}

export interface SafeCommandView {
  description: string;
}

export interface SafePipelineView {
  finalStatus: string;
  completed: boolean;
  commandCount: number;
  commands: SafeCommandView[];
  agentRuns: SafeAgentRunView[];
  failedAgent: string | null;
}

const SAFE_TABLE_NAMES = new Set(ALL_TABLES.flatMap((table) => [table.tableName, table.name]));

const TEXT_REDACTION_PATTERNS = [
  /\brec_[\w-]+\b/gi,
  /\brecdemo[\w-]*\b/gi,
  /\bcand_[\w-]+\b/gi,
  /\bjob_[\w-]+\b/gi,
  /\bbase_app_token\b/gi,
  /\btable_id\b/gi,
  /\brecord_id\b/gi,
  /\bauthorization\b/gi,
  /\bbearer\b/gi,
  /\bpayload\b/gi,
  /\bprompts?\b/gi,
  /\braw(?:[_ -]?(?:response|stdout|stderr))?\b/gi,
  /\bstdout\b/gi,
  /\bstderr\b/gi,
  /\bapi[_ -]?key\b/gi,
  /\bendpoint\b/gi,
  /\bmodel[_ -]?id\b/gi,
  /\bmodel_api\b/gi,
  /\btoken\b/gi,
];

export function redactAgentRun(run: AgentRunRecord): SafeAgentRunView {
  return {
    agent_name: run.agent_name,
    entity_type: run.entity_type,
    entity_ref: redactEntityRef(run.entity_ref),
    input_summary: redactSummaryText(run.input_summary),
    run_status: run.run_status,
    status_before: run.status_before ?? null,
    status_after: run.status_after ?? null,
    retry_count: run.retry_count,
    duration_ms: run.duration_ms,
  };
}

export function redactCommand(cmd: BaseCommandSpec): SafeCommandView {
  return { description: cmd.description };
}

export function redactPipelineResult(result: CandidatePipelineResult): SafePipelineView {
  return {
    finalStatus: result.finalStatus,
    completed: result.completed,
    commandCount: result.commands.length,
    commands: result.commands.map(redactCommand),
    agentRuns: result.agentRuns.map(redactAgentRun),
    failedAgent: result.failedAgent ?? null,
  };
}

export function redactReleaseGate(report: MvpReleaseGateReport): MvpReleaseGateReport {
  return {
    ...report,
    title: redactSafeText(report.title),
    checks: report.checks.map((check) => ({
      ...check,
      name: redactSafeText(check.name),
      summary: redactSafeText(check.summary),
      commandHint: redactSafeText(check.commandHint),
    })),
    recommendedDemoCommands: report.recommendedDemoCommands.map(redactSafeText),
    finalHandoffNote: redactSafeText(report.finalHandoffNote),
  };
}

export function redactApiBoundaryAudit(report: ApiBoundaryAuditReport): ApiBoundaryAuditReport {
  return {
    ...report,
    title: redactSafeText(report.title),
    checks: report.checks.map((check) => ({
      ...check,
      name: redactSafeText(check.name),
      summary: redactSafeText(check.summary),
    })),
    recommendedCommands: report.recommendedCommands.map(redactSafeText),
    finalNote: redactSafeText(report.finalNote),
  };
}

export function redactProviderReadiness(readiness: ProviderAdapterReadiness): ProviderAdapterReadiness {
  const providerName = sanitizeProviderName(readiness.providerName);
  return {
    ...readiness,
    providerName,
    blockedReasons: readiness.blockedReasons.map((reason) =>
      redactProviderText(reason, readiness.providerName, providerName),
    ),
    safeSummary: redactProviderText(readiness.safeSummary, readiness.providerName, providerName),
  };
}

export function redactProviderAgentDemo(result: ProviderAgentDemoResult): ProviderAgentDemoResult {
  const providerName = sanitizeProviderName(result.providerName);
  return {
    ...result,
    providerName,
    agentRunStatus: sanitizeOptionalText(result.agentRunStatus),
    blockedReasons: result.blockedReasons.map((reason) =>
      redactProviderText(reason, result.providerName, providerName),
    ),
    safeSummary: redactProviderText(result.safeSummary, result.providerName, providerName),
  };
}

export function redactProviderSmoke(result: ProviderSmokeResult): ProviderSmokeResult {
  const providerName = sanitizeProviderName(result.providerName);
  return {
    ...result,
    providerName,
    blockedReasons: result.blockedReasons.map((reason) =>
      redactProviderText(reason, result.providerName, providerName),
    ),
    errorKind: sanitizeOptionalText(result.errorKind),
    safeSummary: redactProviderText(result.safeSummary, result.providerName, providerName),
  };
}

export function redactPreApiFreeze(report: PreApiFreezeReport): PreApiFreezeReport {
  return {
    ...report,
    title: redactSafeText(report.title),
    checks: report.checks.map((check) => ({
      ...check,
      name: redactSafeText(check.name),
      summary: redactSafeText(check.summary),
    })),
    allowedNextChanges: report.allowedNextChanges.map(redactSafeText),
    blockedChanges: report.blockedChanges.map(redactSafeText),
    finalNote: redactSafeText(report.finalNote),
  };
}

export function redactLiveReadiness(report: LiveReadinessReport): LiveReadinessReport {
  return {
    ...report,
    checkedAt: redactSafeText(report.checkedAt),
    checks: report.checks.map((check) => ({
      ...check,
      name: redactSafeText(check.name),
      summary: redactSafeText(check.summary),
    })),
    nextStep: redactSafeText(report.nextStep),
  };
}

export function redactWorkEvent(event: WorkEvent): SafeWorkEventView {
  return {
    agent_name: typeof event.agent_name === "string" ? event.agent_name : "未知角色",
    event_type: normalizeEventType(event.event_type),
    tool_type: normalizeToolType(event.tool_type),
    target_table: sanitizeTargetTable(event.target_table),
    execution_mode: normalizeExecutionMode(event.execution_mode),
    guard_status: normalizeGuardStatus(event.guard_status),
    safe_summary: redactSafeText(event.safe_summary),
    status_before: sanitizeOptionalText(event.status_before),
    status_after: sanitizeOptionalText(event.status_after),
    duration_ms: sanitizeDuration(event.duration_ms),
    link: buildSafeLinkForWorkEvent(event),
    created_at: typeof event.created_at === "string" ? event.created_at : "",
  };
}

export function redactWorkEvents(events: WorkEvent[]): SafeWorkEventView[] {
  return events.map(redactWorkEvent);
}

export function buildSafeLinkForWorkEvent(event: WorkEvent): SafeLinkView | null {
  if (!event || event.link_status === "no_link") {
    return null;
  }

  if (event.link_status === "demo_only") {
    return {
      link_id: buildDemoLinkId(event),
      link_label: "飞书记录",
      link_type: inferLinkType(event),
      available: false,
      unavailable_label: "飞书记录未接入",
    };
  }

  return null;
}

export function redactSafeText(text: string): string {
  const value = typeof text === "string" ? text : "";
  let redacted = value;
  for (const pattern of TEXT_REDACTION_PATTERNS) {
    pattern.lastIndex = 0;
    redacted = redacted.replace(pattern, "[已脱敏]");
  }
  return redacted;
}

export function containsSensitivePattern(text: string): boolean {
  const value = typeof text === "string" ? text : "";
  return TEXT_REDACTION_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}

function redactEntityRef(_ref: string): string {
  return "[已脱敏]";
}

function redactSummaryText(text: string): string {
  return redactSafeText(text);
}

function sanitizeTargetTable(value: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  return SAFE_TABLE_NAMES.has(value) ? value : null;
}

function sanitizeOptionalText(value: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  return redactSafeText(value);
}

function sanitizeProviderName(value: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized === "volcengine-ark") {
    return normalized;
  }
  if (!normalized) {
    return "未配置";
  }
  return "自定义供应商";
}

function redactProviderText(text: string, rawProviderName: string, safeProviderName: string): string {
  const value = typeof text === "string" ? text : "";
  const normalized =
    rawProviderName && rawProviderName !== safeProviderName
      ? value.split(rawProviderName).join(safeProviderName)
      : value;
  return redactSafeText(normalized);
}

function sanitizeDuration(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.round(value);
}

function buildDemoLinkId(event: WorkEvent): string {
  const raw = typeof event.event_id === "string" ? event.event_id : "";
  const digits = raw.replace(/\D/g, "").slice(-3);
  return `lnk_demo_${digits.padStart(3, "0") || "000"}`;
}

function inferLinkType(event: WorkEvent): WorkEventLinkType {
  switch (event.target_table) {
    case "candidates":
    case "Candidates":
      return "candidate";
    case "jobs":
    case "Jobs":
      return "job";
    case "evaluations":
    case "Evaluations":
      return "evaluation";
    case "agent_runs":
    case "Agent Runs":
      return "agent_run";
    case "reports":
    case "Reports":
      return "report";
    default:
      return "work_event";
  }
}

function normalizeEventType(value: WorkEvent["event_type"]): WorkEventType {
  switch (value) {
    case "tool_call":
    case "status_transition":
    case "guard_check":
    case "retry":
    case "error":
    case "human_action":
      return value;
    default:
      return "guard_check";
  }
}

function normalizeToolType(value: WorkEvent["tool_type"]): Exclude<WorkEventToolType, null> | null {
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

function normalizeExecutionMode(value: WorkEvent["execution_mode"]): WorkEventExecutionMode {
  switch (value) {
    case "dry_run":
    case "live_read":
    case "live_write":
    case "blocked":
      return value;
    default:
      return "blocked";
  }
}

function normalizeGuardStatus(value: WorkEvent["guard_status"]): WorkEventGuardStatus {
  switch (value) {
    case "passed":
    case "blocked":
    case "skipped":
      return value;
    default:
      return null;
  }
}
