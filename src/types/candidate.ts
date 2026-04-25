import type { CandidateStatus, ScreeningRecommendation, HumanDecision } from "./state.ts";

export interface Candidate {
  candidateId: string;
  displayName: string;
  job: string;
  resumeSource: string | null;
  resumeText: string | null;
  status: CandidateStatus;
  screeningRecommendation: ScreeningRecommendation | null;
  talentPoolCandidate: boolean;
  humanDecision: HumanDecision;
  humanDecisionBy: string | null;
  humanDecisionNote: string | null;
}
