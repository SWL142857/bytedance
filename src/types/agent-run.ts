import type { CandidateStatus } from "./state.ts";

export type AgentName =
  | "hr_coordinator"
  | "resume_parser"
  | "screening"
  | "interview_kit"
  | "analytics";

export type EntityType =
  | "job"
  | "candidate"
  | "evaluation"
  | "interview_kit"
  | "report";

export type RunStatus = "success" | "failed" | "retried" | "skipped";

export interface AgentRun {
  runId: string;
  agentName: AgentName;
  entityType: EntityType;
  entityRef: string;
  inputSummary: string;
  outputJson: string;
  promptTemplateId: string;
  gitCommitHash: string;
  promptHash: string | null;
  statusBefore: CandidateStatus | null;
  statusAfter: CandidateStatus | null;
  runStatus: RunStatus;
  errorMessage: string | null;
  retryCount: number;
  durationMs: number;
}
