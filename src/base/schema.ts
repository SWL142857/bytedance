export type FieldType =
  | "text"
  | "number"
  | "select"
  | "multi_select"
  | "date"
  | "checkbox"
  | "link"
  | "url"
  | "json";

export interface FieldDef {
  name: string;
  type: FieldType;
  required: boolean;
  description: string;
  readonly?: boolean;
  system?: boolean;
  options?: string[];
  linkTo?: string;
}

export interface TableDef {
  name: string;
  tableName: string;
  description: string;
  fields: FieldDef[];
}

export const JOB_TABLE: TableDef = {
  name: "Jobs",
  tableName: "jobs",
  description: "Position/role definitions with requirements and rubrics",
  fields: [
    { name: "job_id", type: "text", required: true, description: "Unique job identifier (application-generated)" },
    { name: "title", type: "text", required: true, description: "Job title" },
    { name: "department", type: "text", required: true, description: "Department" },
    { name: "level", type: "text", required: true, description: "Job level (e.g. P6, Senior)" },
    { name: "requirements", type: "text", required: true, description: "Job requirements text" },
    { name: "rubric", type: "text", required: true, description: "Screening rubric / scoring criteria" },
    { name: "status", type: "select", required: true, description: "Job status", options: ["open", "paused", "closed"] },
    { name: "owner", type: "text", required: true, description: "Hiring manager or recruiter" },
    { name: "created_at", type: "date", required: true, description: "Creation timestamp (application-generated)" },
  ],
};

export const CANDIDATE_TABLE: TableDef = {
  name: "Candidates",
  tableName: "candidates",
  description: "Candidate records with status tracking",
  fields: [
    { name: "candidate_id", type: "text", required: true, description: "Unique candidate identifier (application-generated)" },
    { name: "display_name", type: "text", required: true, description: "Display name or anonymized ID" },
    { name: "job", type: "link", required: true, description: "Linked job record", linkTo: "jobs" },
    { name: "resume_source", type: "url", required: false, description: "Resume source URL or document link" },
    { name: "resume_text", type: "text", required: false, description: "Short resume text; long resumes should use doc links" },
    { name: "status", type: "select", required: true, description: "Pipeline status", options: ["new", "parsed", "screened", "interview_kit_ready", "decision_pending", "offer", "rejected"] },
    { name: "screening_recommendation", type: "select", required: false, description: "Screening result", options: ["strong_match", "review_needed", "weak_match"] },
    { name: "talent_pool_candidate", type: "checkbox", required: false, description: "Suggestion label for talent pool" },
    { name: "human_decision", type: "select", required: false, description: "Human decision result", options: ["offer", "rejected", "none"] },
    { name: "human_decision_by", type: "text", required: false, description: "Human decision maker" },
    { name: "human_decision_note", type: "text", required: false, description: "Decision notes" },
  ],
};

export const RESUME_FACT_TABLE: TableDef = {
  name: "Resume Facts",
  tableName: "resume_facts",
  description: "Structured facts extracted from candidate resumes",
  fields: [
    { name: "candidate", type: "link", required: true, description: "Linked candidate", linkTo: "candidates" },
    { name: "fact_type", type: "select", required: true, description: "Type of fact", options: ["education", "work_experience", "project", "skill", "certificate", "language", "other"] },
    { name: "fact_text", type: "text", required: true, description: "Fact content" },
    { name: "source_excerpt", type: "text", required: false, description: "Short evidence excerpt from resume" },
    { name: "confidence", type: "select", required: true, description: "Extraction confidence", options: ["high", "medium", "low"] },
    { name: "created_by_agent", type: "text", required: true, description: "Agent name that created this fact" },
  ],
};

export const EVALUATION_TABLE: TableDef = {
  name: "Evaluations",
  tableName: "evaluations",
  description: "Screening evaluations per candidate per job",
  fields: [
    { name: "candidate", type: "link", required: true, description: "Linked candidate", linkTo: "candidates" },
    { name: "job", type: "link", required: true, description: "Linked job", linkTo: "jobs" },
    { name: "dimension", type: "text", required: true, description: "Evaluation dimension name" },
    { name: "rating", type: "select", required: true, description: "Rating for this dimension", options: ["strong", "medium", "weak"] },
    { name: "score", type: "number", required: false, description: "Optional numeric score for display only" },
    { name: "recommendation", type: "select", required: true, description: "Overall screening recommendation", options: ["strong_match", "review_needed", "weak_match"] },
    { name: "reason", type: "text", required: true, description: "Evaluation reason" },
    { name: "evidence_refs", type: "text", required: false, description: "Comma-separated evidence references to Resume Facts" },
    { name: "fairness_flags", type: "text", required: false, description: "Fairness risk flags" },
    { name: "talent_pool_signal", type: "text", required: false, description: "Talent pool suggestion reason" },
  ],
};

export const INTERVIEW_KIT_TABLE: TableDef = {
  name: "Interview Kits",
  tableName: "interview_kits",
  description: "Interview preparation materials generated per candidate",
  fields: [
    { name: "candidate", type: "link", required: true, description: "Linked candidate", linkTo: "candidates" },
    { name: "job", type: "link", required: true, description: "Linked job", linkTo: "jobs" },
    { name: "question_list", type: "text", required: true, description: "Structured interview questions" },
    { name: "scorecard", type: "text", required: true, description: "Interview scoring template" },
    { name: "focus_areas", type: "text", required: true, description: "Key focus areas for the interview" },
    { name: "risk_checks", type: "text", required: false, description: "Risks to verify during interview" },
    { name: "created_by_agent", type: "text", required: true, description: "Agent name that created this kit" },
  ],
};

export const AGENT_RUN_TABLE: TableDef = {
  name: "Agent Runs",
  tableName: "agent_runs",
  description: "Audit log for all agent executions — stores evidence, not full reasoning chains",
  fields: [
    { name: "run_id", type: "text", required: true, description: "Unique run identifier (application-generated)" },
    { name: "agent_name", type: "select", required: true, description: "Which agent ran", options: ["hr_coordinator", "resume_parser", "screening", "interview_kit", "analytics"] },
    { name: "entity_type", type: "select", required: true, description: "Entity being processed", options: ["job", "candidate", "evaluation", "interview_kit", "report"] },
    { name: "entity_ref", type: "text", required: true, description: "Reference ID for the entity" },
    { name: "input_summary", type: "text", required: true, description: "Summary of input, never full resume text" },
    { name: "output_json", type: "text", required: false, description: "Agent structured output as JSON string" },
    { name: "prompt_template_id", type: "text", required: true, description: "Prompt template identifier for traceability" },
    { name: "git_commit_hash", type: "text", required: true, description: "Git commit hash at runtime" },
    { name: "prompt_hash", type: "text", required: false, description: "Hash of the full prompt for consistency checks" },
    { name: "status_before", type: "select", required: false, description: "Entity status before agent run", options: ["new", "parsed", "screened", "interview_kit_ready", "decision_pending", "offer", "rejected"] },
    { name: "status_after", type: "select", required: false, description: "Entity status after agent run", options: ["new", "parsed", "screened", "interview_kit_ready", "decision_pending", "offer", "rejected"] },
    { name: "run_status", type: "select", required: true, description: "Execution result", options: ["success", "failed", "retried", "skipped"] },
    { name: "error_message", type: "text", required: false, description: "Error details if failed" },
    { name: "retry_count", type: "number", required: true, description: "Number of retries attempted" },
    { name: "duration_ms", type: "number", required: true, description: "Execution duration in milliseconds" },
  ],
};

export const WORK_EVENT_TABLE: TableDef = {
  name: "Work Events",
  tableName: "work_events",
  description: "Safe operational event log for virtual employee collaboration and guarded actions",
  fields: [
    { name: "event_id", type: "text", required: true, description: "Unique work event identifier (application-generated)" },
    {
      name: "agent_name",
      type: "select",
      required: true,
      description: "Which virtual employee produced the event",
      options: ["hr_coordinator", "resume_parser", "screening", "interview_kit", "analytics"],
    },
    {
      name: "event_type",
      type: "select",
      required: true,
      description: "Operational event category",
      options: ["tool_call", "status_transition", "guard_check", "retry", "error", "human_action"],
    },
    {
      name: "tool_type",
      type: "select",
      required: true,
      description: "Tool family used for this event or none",
      options: ["record_list", "record_upsert", "table_create", "llm_call", "none"],
    },
    { name: "target_table", type: "text", required: false, description: "Safe target table name only" },
    {
      name: "execution_mode",
      type: "select",
      required: true,
      description: "Execution mode for this event",
      options: ["dry_run", "live_read", "live_write", "blocked"],
    },
    {
      name: "guard_status",
      type: "select",
      required: true,
      description: "Guard result or none",
      options: ["passed", "blocked", "skipped", "none"],
    },
    { name: "safe_summary", type: "text", required: true, description: "Chinese safe summary with no secrets or payloads" },
    { name: "status_before", type: "text", required: false, description: "Status before event if applicable" },
    { name: "status_after", type: "text", required: false, description: "Status after event if applicable" },
    { name: "duration_ms", type: "number", required: true, description: "Execution duration in milliseconds" },
    { name: "parent_run_id", type: "text", required: false, description: "Parent run identifier without reasoning content" },
    {
      name: "link_status",
      type: "select",
      required: true,
      description: "Safe link availability for the operator console",
      options: ["has_link", "no_link", "demo_only"],
    },
    { name: "created_at", type: "date", required: true, description: "Event creation timestamp" },
  ],
};

export const REPORT_TABLE: TableDef = {
  name: "Reports",
  tableName: "reports",
  description: "Recruitment analytics reports generated by Analytics Agent",
  fields: [
    { name: "report_id", type: "text", required: true, description: "Unique report identifier (application-generated)" },
    { name: "period_start", type: "date", required: true, description: "Report period start" },
    { name: "period_end", type: "date", required: true, description: "Report period end" },
    { name: "funnel_summary", type: "text", required: true, description: "Pipeline funnel statistics" },
    { name: "quality_summary", type: "text", required: true, description: "Candidate quality overview" },
    { name: "bottlenecks", type: "text", required: false, description: "Process bottleneck analysis" },
    { name: "talent_pool_suggestions", type: "text", required: false, description: "Talent pool recommendations" },
    { name: "recommendations", type: "text", required: false, description: "Recruitment operations suggestions" },
    { name: "created_by_agent", type: "text", required: true, description: "Analytics agent identifier" },
  ],
};

export const ALL_TABLES: TableDef[] = [
  JOB_TABLE,
  CANDIDATE_TABLE,
  RESUME_FACT_TABLE,
  EVALUATION_TABLE,
  INTERVIEW_KIT_TABLE,
  AGENT_RUN_TABLE,
  WORK_EVENT_TABLE,
  REPORT_TABLE,
];

export const TABLE_MAP = new Map(
  ALL_TABLES.map((t) => [t.tableName, t]),
);
