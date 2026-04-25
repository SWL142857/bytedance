import type { ScreeningRecommendation } from "./state.ts";

export type DimensionRating = "strong" | "medium" | "weak";

export interface Evaluation {
  candidate: string;
  job: string;
  dimension: string;
  rating: DimensionRating;
  score: number | null;
  recommendation: ScreeningRecommendation;
  reason: string;
  evidenceRefs: string[];
  fairnessFlags: string[];
  talentPoolSignal: string | null;
}
