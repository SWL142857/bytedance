import type { LlmClient } from "../llm/client.js";
import type { AgentRunRecord } from "../base/runtime.js";
import type { BaseCommandSpec } from "../base/commands.js";
import type { CandidateStatus } from "../types/state.js";
import { parseExtractionOutput, parseGraphBuilderOutput, parseReviewerOutput, parseInterviewKitOutput, type ExtractionOutput, type ReviewerOutput, type InterviewKitOutput } from "../agents/schemas.js";
// New P3 agents (competition prompt-backed)
import { runIntake } from "../agents/intake.js";
import { runExtraction } from "../agents/extraction.js";
import { runReviewer, type ReviewerInput } from "../agents/reviewer.js";
import { runGraphBuilder } from "../agents/graph-builder.js";
// Retained agents
import { runInterviewKit } from "../agents/interview-kit.js";
import { runHrCoordinator } from "../agents/hr-coordinator.js";
// Competition Graph RAG data lookup
import { buildCompetitionCandidateReview } from "../runtime/competition-demo-view-model.js";

export interface CandidatePipelineInput {
  candidateRecordId: string;
  jobRecordId: string;
  candidateId: string;
  jobId: string;
  resumeText: string;
  jobRequirements: string;
  jobRubric: string;
}

export interface CandidatePipelineResult {
  commands: BaseCommandSpec[];
  agentRuns: AgentRunRecord[];
  finalStatus: CandidateStatus;
  completed: boolean;
  failedAgent?: "resume_intake" | "resume_extraction" | "graph_builder" | "interview_kit" | "screening_reviewer" | "hr_coordinator";
}

function decodeExtractionOutput(run: AgentRunRecord): ExtractionOutput {
  const raw = JSON.parse(run.output_json ?? "{}");
  return parseExtractionOutput(raw);
}

function decodeKitOutput(run: AgentRunRecord): InterviewKitOutput {
  const raw = JSON.parse(run.output_json ?? "{}");
  return parseInterviewKitOutput(raw);
}

function decodeGraphBuilderOutput(run: AgentRunRecord) {
  const raw = JSON.parse(run.output_json ?? "{}");
  return parseGraphBuilderOutput(raw);
}

function decodeReviewerOutput(run: AgentRunRecord): ReviewerOutput {
  const raw = JSON.parse(run.output_json ?? "{}");
  return parseReviewerOutput(raw);
}

export async function runCandidatePipeline(
  client: LlmClient,
  input: CandidatePipelineInput,
): Promise<CandidatePipelineResult> {
  const commands: BaseCommandSpec[] = [];
  const agentRuns: AgentRunRecord[] = [];

  // ═══ Stage 1: Resume Intake (deterministic, no LLM) ═══
  // Competition INTAKE_AGENT_PROMPT: package raw resume + JD into clean record
  const intakeResult = await runIntake({
    candidateRecordId: input.candidateRecordId,
    jobRecordId: input.jobRecordId,
    candidateId: input.candidateId,
    jobId: input.jobId,
    resumeText: input.resumeText,
    jobRequirements: input.jobRequirements,
    fromStatus: "new",
  });
  commands.push(...intakeResult.commands);
  agentRuns.push(intakeResult.agentRun);

  if (intakeResult.agentRun.run_status === "failed") {
    return { commands, agentRuns, finalStatus: "new", completed: false, failedAgent: "resume_intake" };
  }

  // ═══ Stage 2: Resume Extraction (LLM structured extraction) ═══
  // Competition EXTRACTION_AGENT_PROMPT: skills + features + profile with confidence scoring
  const extractionResult = await runExtraction(client, {
    candidateRecordId: input.candidateRecordId,
    jobRecordId: input.jobRecordId,
    candidateId: input.candidateId,
    jobId: input.jobId,
    resumeText: input.resumeText,
    jobRequirements: input.jobRequirements,
    fromStatus: "parsed",
  });
  commands.push(...extractionResult.commands);
  agentRuns.push(extractionResult.agentRun);

  if (extractionResult.agentRun.run_status === "failed") {
    return { commands, agentRuns, finalStatus: "parsed", completed: false, failedAgent: "resume_extraction" };
  }

  // Decode extraction output for downstream agents
  let extractionOutput: ExtractionOutput;
  try {
    extractionOutput = decodeExtractionOutput(extractionResult.agentRun);
  } catch {
    return { commands, agentRuns, finalStatus: "screened", completed: false, failedAgent: "resume_extraction" };
  }

  // ═══ Stage 3: Graph Builder (structured graph audit) ═══
  // Uses extracted summaries only; competition evidence still stays out of prompts.
  const graphResult = await runGraphBuilder(client, {
    candidateA: {
      candidateId: input.candidateId,
      skills: extractionOutput.skills.map((s) => s.canonicalName),
      features: extractionOutput.features.map((f) => ({
        featureType: f.featureType,
        canonicalName: f.canonicalName,
        featureValue: f.featureValue,
      })),
      summary: extractionOutput.profile.structuredSummary,
      leadershipLevel: extractionOutput.profile.leadershipLevel,
      systemDesignLevel: extractionOutput.profile.systemDesignLevel,
      educationLevel: extractionOutput.profile.educationLevel,
      yearsOfExperience: extractionOutput.profile.yearsOfExperience,
    },
    candidateB: {
      candidateId: "role_memory",
      skills: [],
      features: [
        {
          featureType: "role_requirement",
          canonicalName: "Job Requirements",
          featureValue: input.jobRequirements.slice(0, 200),
        },
      ],
      summary: input.jobRubric || input.jobRequirements.slice(0, 200),
      leadershipLevel: "unknown",
      systemDesignLevel: "unknown",
      educationLevel: "unknown",
      yearsOfExperience: "unknown",
    },
    jobId: input.jobId,
  });
  commands.push(...graphResult.commands);
  agentRuns.push(graphResult.agentRun);

  if (graphResult.agentRun.run_status === "failed") {
    return { commands, agentRuns, finalStatus: "screened", completed: false, failedAgent: "graph_builder" };
  }

  let graphSignalSummary: string | null = null;
  try {
    const graphOutput = decodeGraphBuilderOutput(graphResult.agentRun);
    graphSignalSummary = graphOutput.shouldLink
      ? `${graphOutput.linkReason} Shared signals: ${graphOutput.sharedSignals.join(", ")}`
      : graphOutput.linkReason;
  } catch {
    return { commands, agentRuns, finalStatus: "screened", completed: false, failedAgent: "graph_builder" };
  }

  // ═══ Stage 4: Interview Kit ═══
  const kitResult = await runInterviewKit(client, {
    candidateRecordId: input.candidateRecordId,
    jobRecordId: input.jobRecordId,
    candidateId: input.candidateId,
    jobId: input.jobId,
    resumeFacts: extractionOutput.skills.map((s) => ({
      factType: "skill" as const,
      factText: `${s.canonicalName}: ${s.evidence}`,
      confidence: s.confidence >= 0.8 ? "high" as const : s.confidence >= 0.5 ? "medium" as const : "low" as const,
    })),
    evaluationSummary: JSON.stringify({
      profile: extractionOutput.profile,
      featureCount: extractionOutput.features.length,
      skillCount: extractionOutput.skills.length,
    }),
    fromStatus: "screened",
  });
  commands.push(...kitResult.commands);
  agentRuns.push(kitResult.agentRun);

  if (kitResult.agentRun.run_status === "failed") {
    return { commands, agentRuns, finalStatus: "screened", completed: false, failedAgent: "interview_kit" };
  }

  // Decode kit output for coordinator
  let kitOutput: InterviewKitOutput;
  try {
    kitOutput = decodeKitOutput(kitResult.agentRun);
  } catch {
    return { commands, agentRuns, finalStatus: "interview_kit_ready", completed: false, failedAgent: "interview_kit" };
  }

  // ═══ Stage 5: Screening Reviewer (graph-enhanced review) ═══
  // Competition REVIEWER_AGENT_PROMPT: synthesizes role memory + graph projection + GNN + neighbors

  // Try to load competition graph context for this candidate
  let graphProjection: ReviewerInput["graphProjection"] = null;
  let gnnSignal: ReviewerInput["gnnSignal"] = null;
  let topNeighbors: ReviewerInput["topNeighbors"] = [];
  try {
    const review = buildCompetitionCandidateReview(input.candidateId);
    if (review) {
      if (review.graphProjection) {
        graphProjection = {
          label: review.graphProjection.label,
          confidence: review.graphProjection.confidence,
          graphScore: review.graphProjection.graphScore,
          reviewMode: review.graphProjection.reviewMode,
          signalSummary: review.graphProjection.signalSummary,
          neighborCount: review.graphProjection.neighborCount,
        };
      }
      if (review.gnnSignal?.available) {
        gnnSignal = {
          selectProbability: review.gnnSignal.selectProbability,
          effectivePrediction: review.gnnSignal.effectivePrediction,
        };
      }
      topNeighbors = review.similarCandidates.map((n) => ({
        candidateId: n.candidateId,
        decision: "unknown",
        similarityScore: n.similarityScore,
        reason: n.edgeReason,
      }));
    }
  } catch {
    // Graph data unavailable — reviewer runs with text-only inputs
  }

  const profileSummary = extractionOutput.profile.structuredSummary ||
    `${extractionOutput.skills.length} skills, ${extractionOutput.features.length} features, ${extractionOutput.profile.yearsOfExperience}y exp`;
  const reviewerResult = await runReviewer(client, {
    candidateRecordId: input.candidateRecordId,
    jobRecordId: input.jobRecordId,
    candidateId: input.candidateId,
    jobId: input.jobId,
    roleMemory: graphSignalSummary
      ? `Job ${input.jobId}: ${input.jobRequirements.slice(0, 200)} Graph builder: ${graphSignalSummary}`
      : `Job ${input.jobId}: ${input.jobRequirements.slice(0, 200)}`,
    candidateProfile: profileSummary,
    graphProjection,
    gnnSignal,
    topNeighbors,
    fromStatus: "interview_kit_ready",
  });
  commands.push(...reviewerResult.commands);
  agentRuns.push(reviewerResult.agentRun);

  if (reviewerResult.agentRun.run_status === "failed") {
    return { commands, agentRuns, finalStatus: "interview_kit_ready", completed: false, failedAgent: "screening_reviewer" };
  }

  // Decode reviewer output for coordinator
  let reviewerOutput: ReviewerOutput;
  try {
    reviewerOutput = decodeReviewerOutput(reviewerResult.agentRun);
  } catch {
    return { commands, agentRuns, finalStatus: "decision_pending", completed: false, failedAgent: "screening_reviewer" };
  }

  // ═══ Stage 6: HR Coordinator ═══
  const coordinatorResult = await runHrCoordinator(client, {
    candidateRecordId: input.candidateRecordId,
    candidateId: input.candidateId,
    jobId: input.jobId,
    screeningRecommendation: reviewerOutput.decisionPred === "select" ? "strong_match" : "weak_match",
    focusAreas: kitOutput.focusAreas,
    riskChecks: kitOutput.riskChecks,
    fromStatus: "decision_pending",
  });
  commands.push(...coordinatorResult.commands);
  agentRuns.push(coordinatorResult.agentRun);

  if (coordinatorResult.agentRun.run_status === "failed") {
    return { commands, agentRuns, finalStatus: "decision_pending", completed: false, failedAgent: "hr_coordinator" };
  }

  return { commands, agentRuns, finalStatus: "decision_pending", completed: true };
}
