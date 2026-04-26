import type { BaseCommandSpec } from "../base/commands.js";
import type { ResolvedRecord } from "../base/record-resolution.js";
import { buildMvpRecordContext, MVP_JOB_IDENTITY, MVP_CANDIDATE_IDENTITY } from "../base/mvp-resolution.js";
import type { LlmClient } from "../llm/client.js";
import { DeterministicLlmClient } from "../llm/deterministic-client.js";
import { runCandidatePipeline, type CandidatePipelineResult } from "./candidate-pipeline.js";
import { buildHumanDecisionPlan } from "./human-decision.js";
import { runAnalytics } from "../agents/analytics.js";

export interface LiveMvpPlanInput {
  resolvedRecords: ResolvedRecord[];
  decision: "offer" | "rejected";
  decidedBy: string;
  decisionNote: string;
}

export interface LiveMvpPlanResult {
  commands: BaseCommandSpec[];
  pipeline: CandidatePipelineResult;
  finalDecisionStatus: "offer" | "rejected";
  reportRunStatus: "success" | "failed" | "retried" | "skipped";
}

export class LiveMvpPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveMvpPlanError";
  }
}

const DEMO_RESUME_TEXT =
  "AI Product Manager with 6 years experience in technology sector. " +
  "Led development of a natural language search feature at a fictional tech company. " +
  "Managed cross-functional teams of 8-12 engineers and designers. " +
  "Bachelor's degree in Computer Science from Fictional University. " +
  "Skills: product roadmapping, SQL, Python basics, A/B testing, user research.";

const DEMO_JOB_REQUIREMENTS =
  "5+ years in product management. Experience with AI/ML products. " +
  "Familiarity with NLP or recommendation systems. Cross-functional collaboration. " +
  "Data-driven decision making.";

const DEMO_JOB_RUBRIC =
  "Technical depth: understanding of ML pipeline and model lifecycle. " +
  "Product sense: ability to prioritize features and define success metrics. " +
  "Communication: clarity in writing specs and presenting to stakeholders.";

export async function buildLiveMvpPlan(
  input: LiveMvpPlanInput,
  client: LlmClient = new DeterministicLlmClient(),
): Promise<LiveMvpPlanResult> {
  const ctx = buildMvpRecordContext(input.resolvedRecords);

  const pipeline = await runCandidatePipeline(client, {
    candidateRecordId: ctx.candidateRecordId,
    jobRecordId: ctx.jobRecordId,
    candidateId: MVP_CANDIDATE_IDENTITY.businessId,
    jobId: MVP_JOB_IDENTITY.businessId,
    resumeText: DEMO_RESUME_TEXT,
    jobRequirements: DEMO_JOB_REQUIREMENTS,
    jobRubric: DEMO_JOB_RUBRIC,
  });

  if (!pipeline.completed || pipeline.finalStatus !== "decision_pending") {
    throw new LiveMvpPlanError(
      `Cannot build live MVP write plan: pipeline stopped at ${pipeline.finalStatus}` +
      (pipeline.failedAgent ? ` after ${pipeline.failedAgent}` : ""),
    );
  }

  const decision = buildHumanDecisionPlan({
    candidateRecordId: ctx.candidateRecordId,
    candidateId: MVP_CANDIDATE_IDENTITY.businessId,
    decision: input.decision,
    decidedBy: input.decidedBy,
    decisionNote: input.decisionNote,
    fromStatus: "decision_pending",
  });

  const report = await runAnalytics(client, {
    reportId: "rpt_2026_w17",
    periodStart: "2026-04-19 00:00:00",
    periodEnd: "2026-04-25 23:59:59",
    candidates: [
      {
        candidateId: MVP_CANDIDATE_IDENTITY.businessId,
        status: decision.finalStatus,
        screeningRecommendation: "strong_match",
        talentPoolCandidate: false,
      },
    ],
    evaluations: [
      { candidateId: MVP_CANDIDATE_IDENTITY.businessId, dimension: "technical_depth", rating: "strong", recommendation: "strong_match", fairnessFlags: [], talentPoolSignal: null },
      { candidateId: MVP_CANDIDATE_IDENTITY.businessId, dimension: "product_sense", rating: "strong", recommendation: "strong_match", fairnessFlags: [], talentPoolSignal: null },
      { candidateId: MVP_CANDIDATE_IDENTITY.businessId, dimension: "communication", rating: "medium", recommendation: "strong_match", fairnessFlags: [], talentPoolSignal: null },
    ],
    agentRuns: pipeline.agentRuns.map((r) => ({
      agentName: r.agent_name,
      runStatus: r.run_status,
    })),
  });

  const commands = [
    ...pipeline.commands,
    ...decision.commands,
    ...report.commands,
  ];

  return {
    commands,
    pipeline,
    finalDecisionStatus: decision.finalStatus,
    reportRunStatus: report.agentRun.run_status,
  };
}
