export type OperatorTaskKind =
  | "local_mvp_demo"
  | "api_boundary_audit"
  | "live_readiness_report"
  | "analytics_report"
  | "provider_readiness"
  | "provider_smoke_dry_run"
  | "provider_agent_demo_dry_run"
  | "release_gate";

export type OperatorTaskCategory = "dry_run" | "readiness" | "report";

export type OperatorTaskAvailability =
  | "available_readonly"
  | "disabled_phase_pending"
  | "disabled_requires_human_approval";

export interface SafeOperatorTaskView {
  task_kind: OperatorTaskKind;
  category: OperatorTaskCategory;
  display_name: string;
  description: string;
  availability: OperatorTaskAvailability;
  execute_enabled: boolean;
  guard_summary: string;
  blocked_reasons: string[];
}

export interface OperatorTasksOverviewView {
  tasks: SafeOperatorTaskView[];
  safety: {
    read_only: boolean;
    real_writes: boolean;
    external_model_calls: boolean;
    demo_mode: boolean;
  };
  notice: string;
}
