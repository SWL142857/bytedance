export type WorkEventType =
  | "tool_call"
  | "status_transition"
  | "guard_check"
  | "retry"
  | "error"
  | "human_action";

export type WorkEventToolType =
  | "record_list"
  | "record_upsert"
  | "table_create"
  | "llm_call"
  | null;

export type WorkEventExecutionMode =
  | "dry_run"
  | "live_read"
  | "live_write"
  | "blocked";

export type WorkEventGuardStatus = "passed" | "blocked" | "skipped" | null;

export type WorkEventLinkStatus = "has_link" | "no_link" | "demo_only";

export type WorkEventLinkType =
  | "candidate"
  | "job"
  | "evaluation"
  | "agent_run"
  | "work_event"
  | "report";

export interface WorkEvent {
  event_id: string;
  agent_name: string;
  event_type: WorkEventType;
  tool_type: WorkEventToolType;
  target_table: string | null;
  execution_mode: WorkEventExecutionMode;
  guard_status: WorkEventGuardStatus;
  safe_summary: string;
  status_before: string | null;
  status_after: string | null;
  duration_ms: number;
  parent_run_id: string | null;
  link_status: WorkEventLinkStatus;
  created_at: string;
}

export interface SafeLinkView {
  link_id: string;
  link_label: string;
  link_type: WorkEventLinkType;
  available: boolean;
  unavailable_label: string | null;
}

export interface SafeWorkEventView {
  agent_name: string;
  event_type: WorkEventType;
  tool_type: Exclude<WorkEventToolType, null> | null;
  target_table: string | null;
  execution_mode: WorkEventExecutionMode;
  guard_status: WorkEventGuardStatus;
  safe_summary: string;
  status_before: string | null;
  status_after: string | null;
  duration_ms: number;
  link: SafeLinkView | null;
  created_at: string;
}

export interface OrgOverviewAgentView {
  agent_name: string;
  role_label: string;
  status: "空闲" | "工作中" | "阻塞" | "需要人工处理";
  last_event_summary: string;
  duration_ms: number | null;
}

export interface OrgOverviewPipelineView {
  final_status: string;
  completed: boolean;
  command_count: number;
  stage_counts: Array<{ label: string; count: number }>;
}

export interface OrgOverviewSafetyView {
  read_only: boolean;
  real_writes: boolean;
  external_model_calls: boolean;
  demo_mode: boolean;
}

export type DataSourceMode = "runtime_snapshot" | "demo_fixture";
export type SnapshotSource = "deterministic" | "provider";

export interface DataSourceView {
  mode: DataSourceMode;
  snapshot_source: SnapshotSource | null;
  label: string;
  generated_at: string | null;
  external_model_calls: boolean;
  real_writes: false;
}

export interface OrgOverviewView {
  agents: OrgOverviewAgentView[];
  pipeline: OrgOverviewPipelineView;
  recent_events: SafeWorkEventView[];
  safety: OrgOverviewSafetyView;
  data_source: DataSourceView;
}
