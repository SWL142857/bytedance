export type CandidateStatus =
  | "new"
  | "parsed"
  | "screened"
  | "interview_kit_ready"
  | "decision_pending"
  | "offer"
  | "rejected";

export type ScreeningRecommendation =
  | "strong_match"
  | "review_needed"
  | "weak_match";

export type HumanDecision = "offer" | "rejected" | "none";

export interface StateTransition {
  from: CandidateStatus;
  to: CandidateStatus;
  agent: string | null;
  requiresHuman: boolean;
}
