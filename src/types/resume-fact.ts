export type FactType =
  | "education"
  | "work_experience"
  | "project"
  | "skill"
  | "certificate"
  | "language"
  | "other";

export type Confidence = "high" | "medium" | "low";

export interface ResumeFact {
  candidate: string;
  factType: FactType;
  factText: string;
  sourceExcerpt: string | null;
  confidence: Confidence;
  createdByAgent: string;
}
