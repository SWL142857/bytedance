import type { ScreeningRecommendation, Confidence, FactType } from "../types/index.ts";

export interface HrCoordinatorOutput {
  handoffSummary: string;
  nextStep: "human_decision";
  coordinatorChecklist: string[];
}

export interface AnalyticsOutput {
  funnelSummary: string;
  qualitySummary: string;
  bottlenecks: string[];
  talentPoolSuggestions: string[];
  recommendations: string[];
}

export interface ResumeParserOutput {
  facts: Array<{
    factType: FactType;
    factText: string;
    sourceExcerpt: string | null;
    confidence: Confidence;
  }>;
  parseStatus: "success" | "partial" | "failed";
  errorMessage?: string;
}

export interface ScreeningOutput {
  recommendation: ScreeningRecommendation;
  dimensionRatings: Array<{
    dimension: string;
    rating: "strong" | "medium" | "weak";
    reason: string;
    evidenceRefs: string[];
  }>;
  fairnessFlags: string[];
  talentPoolSignal: string | null;
}

export interface InterviewKitOutput {
  questions: Array<{
    question: string;
    purpose: string;
    followUps: string[];
  }>;
  scorecardDimensions: string[];
  focusAreas: string[];
  riskChecks: string[];
}

// ── P3 Competition Agent Output Schemas ──

export interface IntakeOutput {
  candidateId: string;
  resumeRaw: string;
  targetRole: string;
  jobDescriptionRaw: string;
  intakeTimestamp: string;
  sourceMetadata: {
    submissionChannel: string | null;
    languageDetected: string;
    charCount: number;
  };
}

export interface ExtractionOutput {
  skills: Array<{
    name: string;
    canonicalName: string;
    confidence: number;
    evidence: string;
  }>;
  features: Array<{
    featureType: string;
    featureName: string;
    canonicalName: string;
    featureValue: string;
    confidence: number;
    evidence: string;
  }>;
  profile: {
    yearsOfExperience: string;
    educationLevel: string;
    industryBackground: string;
    leadershipLevel: string;
    communicationLevel: string;
    systemDesignLevel: string;
    structuredSummary: string;
  };
}

export interface GraphBuilderOutput {
  shouldLink: boolean;
  linkReason: string;
  sharedSignals: string[];
}

export interface ReviewerOutput {
  decisionPred: "select" | "reject";
  confidence: number;
  reasonLabel: string;
  reasonGroup: string;
  reviewSummary: string;
}

const FORBIDDEN_KEYS = [
  "reasoning_chain",
  "raw_resume",
  "full_resume",
  "raw_prompt",
  "full_prompt",
  "thinking",
  "chain_of_thought",
  "cot",
] as const;

const VALID_FACT_TYPES: FactType[] = [
  "education",
  "work_experience",
  "project",
  "skill",
  "certificate",
  "language",
  "other",
];

const VALID_CONFIDENCES: Confidence[] = ["high", "medium", "low"];

const VALID_RECOMMENDATIONS: ScreeningRecommendation[] = [
  "strong_match",
  "review_needed",
  "weak_match",
];

const VALID_RATINGS = ["strong", "medium", "weak"] as const;

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function parseStringArray(value: unknown, fieldName: string): string[] {
  if (!isArray(value)) throw new SchemaValidationError(`${fieldName} must be an array`);
  const parsed: string[] = [];
  for (const item of value) {
    if (!isString(item)) throw new SchemaValidationError(`Each ${fieldName} item must be a string`);
    parsed.push(item);
  }
  return parsed;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isParseStatus(value: unknown): value is ResumeParserOutput["parseStatus"] {
  return isString(value) && ["success", "partial", "failed"].includes(value);
}

function hasForbiddenKeys(obj: Record<string, unknown>): string | null {
  for (const key of FORBIDDEN_KEYS) {
    if (key in obj) return key;
  }
  return null;
}

function isValidFactType(value: unknown): value is FactType {
  return isString(value) && VALID_FACT_TYPES.includes(value as FactType);
}

function isValidConfidence(value: unknown): value is Confidence {
  return isString(value) && VALID_CONFIDENCES.includes(value as Confidence);
}

function isValidRecommendation(value: unknown): value is ScreeningRecommendation {
  return isString(value) && VALID_RECOMMENDATIONS.includes(value as ScreeningRecommendation);
}

function isValidRating(value: unknown): value is "strong" | "medium" | "weak" {
  return isString(value) && VALID_RATINGS.includes(value as "strong" | "medium" | "weak");
}

export class SchemaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaValidationError";
  }
}

// --- Resume Parser ---

const RESUME_FACT_ALLOWED_KEYS = new Set([
  "factType", "factText", "sourceExcerpt", "confidence",
]);

const RESUME_PARSER_ALLOWED_KEYS = new Set([
  "facts", "parseStatus", "errorMessage",
]);

function parseResumeFact(value: unknown): ResumeParserOutput["facts"][number] {
  if (!isObject(value)) throw new SchemaValidationError("Each fact must be an object");
  const forbidden = hasForbiddenKeys(value);
  if (forbidden) throw new SchemaValidationError(`Forbidden key "${forbidden}" in fact`);
  for (const key of Object.keys(value)) {
    if (!RESUME_FACT_ALLOWED_KEYS.has(key)) {
      throw new SchemaValidationError(`Unknown key "${key}" in fact`);
    }
  }
  const { factType, factText, sourceExcerpt, confidence } = value;
  if (!isValidFactType(factType)) throw new SchemaValidationError(`Invalid factType: ${String(factType)}`);
  if (!isString(factText)) throw new SchemaValidationError("factText must be a string");
  if (sourceExcerpt !== undefined && sourceExcerpt !== null && !isString(sourceExcerpt)) {
    throw new SchemaValidationError("sourceExcerpt must be a string or null");
  }
  const normalizedSourceExcerpt = sourceExcerpt ?? null;
  if (!isValidConfidence(confidence)) throw new SchemaValidationError(`Invalid confidence: ${String(confidence)}`);
  return { factType, factText, sourceExcerpt: normalizedSourceExcerpt, confidence };
}

export function parseResumeParserOutput(value: unknown): ResumeParserOutput {
  if (!isObject(value)) throw new SchemaValidationError("ResumeParserOutput must be an object");
  const forbidden = hasForbiddenKeys(value);
  if (forbidden) throw new SchemaValidationError(`Forbidden key "${forbidden}" in ResumeParserOutput`);
  for (const key of Object.keys(value)) {
    if (!RESUME_PARSER_ALLOWED_KEYS.has(key)) {
      throw new SchemaValidationError(`Unknown key "${key}" in ResumeParserOutput`);
    }
  }
  const { facts, parseStatus, errorMessage } = value;
  if (!isArray(facts)) throw new SchemaValidationError("facts must be an array");
  const parsedFacts = facts.map((f) => parseResumeFact(f));
  if (!isParseStatus(parseStatus)) {
    throw new SchemaValidationError(`Invalid parseStatus: ${String(parseStatus)}`);
  }
  if (errorMessage !== undefined && !isString(errorMessage)) {
    throw new SchemaValidationError("errorMessage must be a string if present");
  }
  return errorMessage !== undefined
    ? { facts: parsedFacts, parseStatus, errorMessage }
    : { facts: parsedFacts, parseStatus };
}

// --- Screening ---

const DIMENSION_RATING_ALLOWED_KEYS = new Set([
  "dimension", "rating", "reason", "evidenceRefs",
]);

const SCREENING_ALLOWED_KEYS = new Set([
  "recommendation", "dimensionRatings", "fairnessFlags", "talentPoolSignal",
]);

function parseDimensionRating(value: unknown): ScreeningOutput["dimensionRatings"][number] {
  if (!isObject(value)) throw new SchemaValidationError("Each dimensionRating must be an object");
  const forbidden = hasForbiddenKeys(value);
  if (forbidden) throw new SchemaValidationError(`Forbidden key "${forbidden}" in dimensionRating`);
  for (const key of Object.keys(value)) {
    if (!DIMENSION_RATING_ALLOWED_KEYS.has(key)) {
      throw new SchemaValidationError(`Unknown key "${key}" in dimensionRating`);
    }
  }
  const { dimension, rating, reason, evidenceRefs } = value;
  if (!isString(dimension)) throw new SchemaValidationError("dimension must be a string");
  if (!isValidRating(rating)) throw new SchemaValidationError(`Invalid rating: ${String(rating)}`);
  if (!isString(reason)) throw new SchemaValidationError("reason must be a string");
  const parsedEvidenceRefs = parseStringArray(evidenceRefs, "evidenceRefs");
  return { dimension, rating, reason, evidenceRefs: parsedEvidenceRefs };
}

export function parseScreeningOutput(value: unknown): ScreeningOutput {
  if (!isObject(value)) throw new SchemaValidationError("ScreeningOutput must be an object");
  const forbidden = hasForbiddenKeys(value);
  if (forbidden) throw new SchemaValidationError(`Forbidden key "${forbidden}" in ScreeningOutput`);
  for (const key of Object.keys(value)) {
    if (!SCREENING_ALLOWED_KEYS.has(key)) {
      throw new SchemaValidationError(`Unknown key "${key}" in ScreeningOutput`);
    }
  }
  const { recommendation, dimensionRatings, fairnessFlags, talentPoolSignal } = value;
  if (!isValidRecommendation(recommendation)) throw new SchemaValidationError(`Invalid recommendation: ${String(recommendation)}`);
  if (!isArray(dimensionRatings)) throw new SchemaValidationError("dimensionRatings must be an array");
  const parsedRatings = dimensionRatings.map((r) => parseDimensionRating(r));
  const parsedFairnessFlags = parseStringArray(fairnessFlags, "fairnessFlags");
  if (talentPoolSignal !== null && talentPoolSignal !== undefined && !isString(talentPoolSignal)) {
    throw new SchemaValidationError("talentPoolSignal must be a string or null");
  }
  const normalizedTalentPoolSignal = talentPoolSignal ?? null;
  return { recommendation, dimensionRatings: parsedRatings, fairnessFlags: parsedFairnessFlags, talentPoolSignal: normalizedTalentPoolSignal };
}

// --- Interview Kit ---

const QUESTION_ALLOWED_KEYS = new Set([
  "question", "purpose", "followUps",
]);

const INTERVIEW_KIT_ALLOWED_KEYS = new Set([
  "questions", "scorecardDimensions", "focusAreas", "riskChecks",
]);

function parseQuestion(value: unknown): InterviewKitOutput["questions"][number] {
  if (!isObject(value)) throw new SchemaValidationError("Each question must be an object");
  const forbidden = hasForbiddenKeys(value);
  if (forbidden) throw new SchemaValidationError(`Forbidden key "${forbidden}" in question`);
  for (const key of Object.keys(value)) {
    if (!QUESTION_ALLOWED_KEYS.has(key)) {
      throw new SchemaValidationError(`Unknown key "${key}" in question`);
    }
  }
  const { question, purpose, followUps } = value;
  if (!isString(question)) throw new SchemaValidationError("question must be a string");
  if (!isString(purpose)) throw new SchemaValidationError("purpose must be a string");
  const parsedFollowUps = parseStringArray(followUps, "followUps");
  return { question, purpose, followUps: parsedFollowUps };
}

export function parseInterviewKitOutput(value: unknown): InterviewKitOutput {
  if (!isObject(value)) throw new SchemaValidationError("InterviewKitOutput must be an object");
  const forbidden = hasForbiddenKeys(value);
  if (forbidden) throw new SchemaValidationError(`Forbidden key "${forbidden}" in InterviewKitOutput`);
  for (const key of Object.keys(value)) {
    if (!INTERVIEW_KIT_ALLOWED_KEYS.has(key)) {
      throw new SchemaValidationError(`Unknown key "${key}" in InterviewKitOutput`);
    }
  }
  const { questions, scorecardDimensions, focusAreas, riskChecks } = value;
  if (!isArray(questions)) throw new SchemaValidationError("questions must be an array");
  const parsedQuestions = questions.map((q) => parseQuestion(q));
  const parsedScorecardDimensions = parseStringArray(scorecardDimensions, "scorecardDimensions");
  const parsedFocusAreas = parseStringArray(focusAreas, "focusAreas");
  const parsedRiskChecks = parseStringArray(riskChecks, "riskChecks");
  return {
    questions: parsedQuestions,
    scorecardDimensions: parsedScorecardDimensions,
    focusAreas: parsedFocusAreas,
    riskChecks: parsedRiskChecks,
  };
}

// --- HR Coordinator ---

const HR_COORDINATOR_ALLOWED_KEYS = new Set([
  "handoffSummary", "nextStep", "coordinatorChecklist",
]);

export function parseHrCoordinatorOutput(value: unknown): HrCoordinatorOutput {
  if (!isObject(value)) throw new SchemaValidationError("HrCoordinatorOutput must be an object");
  const forbidden = hasForbiddenKeys(value);
  if (forbidden) throw new SchemaValidationError(`Forbidden key "${forbidden}" in HrCoordinatorOutput`);
  for (const key of Object.keys(value)) {
    if (!HR_COORDINATOR_ALLOWED_KEYS.has(key)) {
      throw new SchemaValidationError(`Unknown key "${key}" in HrCoordinatorOutput`);
    }
  }
  const { handoffSummary, nextStep, coordinatorChecklist } = value;
  if (!isString(handoffSummary)) throw new SchemaValidationError("handoffSummary must be a string");
  if (nextStep !== "human_decision") throw new SchemaValidationError(`nextStep must be "human_decision", got "${String(nextStep)}"`);
  const parsedChecklist = parseStringArray(coordinatorChecklist, "coordinatorChecklist");
  return { handoffSummary, nextStep, coordinatorChecklist: parsedChecklist };
}

// --- Analytics ---

const ANALYTICS_ALLOWED_KEYS = new Set([
  "funnelSummary", "qualitySummary", "bottlenecks", "talentPoolSuggestions", "recommendations",
]);

export function parseAnalyticsOutput(value: unknown): AnalyticsOutput {
  if (!isObject(value)) throw new SchemaValidationError("AnalyticsOutput must be an object");
  const forbidden = hasForbiddenKeys(value);
  if (forbidden) throw new SchemaValidationError(`Forbidden key "${forbidden}" in AnalyticsOutput`);
  for (const key of Object.keys(value)) {
    if (!ANALYTICS_ALLOWED_KEYS.has(key)) {
      throw new SchemaValidationError(`Unknown key "${key}" in AnalyticsOutput`);
    }
  }
  const { funnelSummary, qualitySummary, bottlenecks, talentPoolSuggestions, recommendations } = value;
  if (!isString(funnelSummary)) throw new SchemaValidationError("funnelSummary must be a string");
  if (!isString(qualitySummary)) throw new SchemaValidationError("qualitySummary must be a string");
  const parsedBottlenecks = parseStringArray(bottlenecks, "bottlenecks");
  const parsedTalentPool = parseStringArray(talentPoolSuggestions, "talentPoolSuggestions");
  const parsedRecommendations = parseStringArray(recommendations, "recommendations");
  return {
    funnelSummary,
    qualitySummary,
    bottlenecks: parsedBottlenecks,
    talentPoolSuggestions: parsedTalentPool,
    recommendations: parsedRecommendations,
  };
}

// ── P3 Competition Agent Parse Functions ──

function parseNumberField(value: unknown, fieldName: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new SchemaValidationError(`${fieldName} must be a finite number`);
}

// --- Intake ---

export function parseIntakeOutput(value: unknown): IntakeOutput {
  if (!isObject(value)) throw new SchemaValidationError("IntakeOutput must be an object");
  const { candidateId, resumeRaw, targetRole, jobDescriptionRaw, intakeTimestamp, sourceMetadata } = value as Record<string, unknown>;
  if (!isString(candidateId)) throw new SchemaValidationError("candidateId must be a string");
  if (!isString(resumeRaw)) throw new SchemaValidationError("resumeRaw must be a string");
  if (!isString(targetRole)) throw new SchemaValidationError("targetRole must be a string");
  if (!isString(jobDescriptionRaw)) throw new SchemaValidationError("jobDescriptionRaw must be a string");
  if (!isString(intakeTimestamp)) throw new SchemaValidationError("intakeTimestamp must be a string");
  if (!isObject(sourceMetadata)) throw new SchemaValidationError("sourceMetadata must be an object");
  const sm = sourceMetadata as Record<string, unknown>;
  return {
    candidateId,
    resumeRaw,
    targetRole,
    jobDescriptionRaw,
    intakeTimestamp,
    sourceMetadata: {
      submissionChannel: sm.submissionChannel !== undefined && sm.submissionChannel !== null ? String(sm.submissionChannel) : null,
      languageDetected: isString(sm.languageDetected) ? sm.languageDetected : "unknown",
      charCount: typeof sm.charCount === "number" ? sm.charCount : 0,
    },
  };
}

// --- Extraction ---

function parseExtractionSkill(value: unknown): ExtractionOutput["skills"][number] {
  if (!isObject(value)) throw new SchemaValidationError("Each skill must be an object");
  const { name, canonicalName, confidence, evidence } = value as Record<string, unknown>;
  if (!isString(name)) throw new SchemaValidationError("skill.name must be a string");
  if (!isString(canonicalName)) throw new SchemaValidationError("skill.canonicalName must be a string");
  return {
    name,
    canonicalName,
    confidence: parseNumberField(confidence, "skill.confidence"),
    evidence: isString(evidence) ? evidence : "",
  };
}

function parseExtractionFeature(value: unknown): ExtractionOutput["features"][number] {
  if (!isObject(value)) throw new SchemaValidationError("Each feature must be an object");
  const { featureType, featureName, canonicalName, featureValue, confidence, evidence } = value as Record<string, unknown>;
  if (!isString(featureType)) throw new SchemaValidationError("feature.featureType must be a string");
  if (!isString(featureName)) throw new SchemaValidationError("feature.featureName must be a string");
  if (!isString(canonicalName)) throw new SchemaValidationError("feature.canonicalName must be a string");
  return {
    featureType,
    featureName,
    canonicalName,
    featureValue: isString(featureValue) ? featureValue : "",
    confidence: parseNumberField(confidence, "feature.confidence"),
    evidence: isString(evidence) ? evidence : "",
  };
}

export function parseExtractionOutput(value: unknown): ExtractionOutput {
  if (!isObject(value)) throw new SchemaValidationError("ExtractionOutput must be an object");
  const obj = value as Record<string, unknown>;
  if (!isArray(obj.skills)) throw new SchemaValidationError("skills must be an array");
  if (!isArray(obj.features)) throw new SchemaValidationError("features must be an array");
  const skills = obj.skills.map(parseExtractionSkill);
  const features = obj.features.map(parseExtractionFeature);
  const profile = isObject(obj.profile) ? obj.profile as Record<string, unknown> : {};
  return {
    skills,
    features,
    profile: {
      yearsOfExperience: isString(profile.yearsOfExperience) ? profile.yearsOfExperience : "unknown",
      educationLevel: isString(profile.educationLevel) ? profile.educationLevel : "unknown",
      industryBackground: isString(profile.industryBackground) ? profile.industryBackground : "unknown",
      leadershipLevel: isString(profile.leadershipLevel) ? profile.leadershipLevel : "unknown",
      communicationLevel: isString(profile.communicationLevel) ? profile.communicationLevel : "unknown",
      systemDesignLevel: isString(profile.systemDesignLevel) ? profile.systemDesignLevel : "unknown",
      structuredSummary: isString(profile.structuredSummary) ? profile.structuredSummary : "",
    },
  };
}

// --- Graph Builder ---

export function parseGraphBuilderOutput(value: unknown): GraphBuilderOutput {
  if (!isObject(value)) throw new SchemaValidationError("GraphBuilderOutput must be an object");
  const { shouldLink, linkReason, sharedSignals } = value as Record<string, unknown>;
  if (typeof shouldLink !== "boolean") throw new SchemaValidationError("shouldLink must be a boolean");
  if (!isString(linkReason)) throw new SchemaValidationError("linkReason must be a string");
  const parsedSignals = parseStringArray(sharedSignals, "sharedSignals");
  return { shouldLink, linkReason, sharedSignals: parsedSignals };
}

// --- Reviewer ---

export function parseReviewerOutput(value: unknown): ReviewerOutput {
  if (!isObject(value)) throw new SchemaValidationError("ReviewerOutput must be an object");
  const { decisionPred, confidence, reasonLabel, reasonGroup, reviewSummary } = value as Record<string, unknown>;
  if (decisionPred !== "select" && decisionPred !== "reject") {
    throw new SchemaValidationError(`decisionPred must be "select" or "reject", got ${String(decisionPred)}`);
  }
  if (!isString(reasonLabel)) throw new SchemaValidationError("reasonLabel must be a string");
  if (!isString(reasonGroup)) throw new SchemaValidationError("reasonGroup must be a string");
  if (!isString(reviewSummary)) throw new SchemaValidationError("reviewSummary must be a string");
  return {
    decisionPred,
    confidence: parseNumberField(confidence, "confidence"),
    reasonLabel,
    reasonGroup,
    reviewSummary,
  };
}
