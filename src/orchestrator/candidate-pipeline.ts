import type { LlmClient } from "../llm/client.js";
import type { AgentRunRecord } from "../base/runtime.js";
import type { BaseCommandSpec } from "../base/commands.js";
import type { CandidateStatus } from "../types/state.js";
import { parseResumeParserOutput, parseScreeningOutput, parseInterviewKitOutput, type ResumeParserOutput, type ScreeningOutput, type InterviewKitOutput } from "../agents/schemas.js";
import { runResumeParser } from "../agents/resume-parser.js";
import { runScreener } from "../agents/screener.js";
import { runInterviewKit } from "../agents/interview-kit.js";
import { runHrCoordinator } from "../agents/hr-coordinator.js";

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
  failedAgent?: "resume_parser" | "screening" | "interview_kit" | "hr_coordinator";
}

function decodeParserOutput(run: AgentRunRecord): ResumeParserOutput {
  const raw = JSON.parse(run.output_json ?? "{}");
  return parseResumeParserOutput(raw);
}

function decodeScreeningOutput(run: AgentRunRecord): ScreeningOutput {
  const raw = JSON.parse(run.output_json ?? "{}");
  return parseScreeningOutput(raw);
}

function decodeKitOutput(run: AgentRunRecord): InterviewKitOutput {
  const raw = JSON.parse(run.output_json ?? "{}");
  return parseInterviewKitOutput(raw);
}

export async function runCandidatePipeline(
  client: LlmClient,
  input: CandidatePipelineInput,
): Promise<CandidatePipelineResult> {
  const commands: BaseCommandSpec[] = [];
  const agentRuns: AgentRunRecord[] = [];

  // Stage 1: Resume Parser
  const parserResult = await runResumeParser(client, {
    candidateRecordId: input.candidateRecordId,
    candidateId: input.candidateId,
    resumeText: input.resumeText,
    fromStatus: "new",
  });
  commands.push(...parserResult.commands);
  agentRuns.push(parserResult.agentRun);

  if (parserResult.agentRun.run_status === "failed") {
    return { commands, agentRuns, finalStatus: "new", completed: false, failedAgent: "resume_parser" };
  }

  // Stage 2: Screening — decode parser output through schema validator
  let parserOutput: ResumeParserOutput;
  try {
    parserOutput = decodeParserOutput(parserResult.agentRun);
  } catch {
    return { commands, agentRuns, finalStatus: "parsed", completed: false, failedAgent: "resume_parser" };
  }

  const screenerResult = await runScreener(client, {
    candidateRecordId: input.candidateRecordId,
    jobRecordId: input.jobRecordId,
    candidateId: input.candidateId,
    jobId: input.jobId,
    resumeFacts: parserOutput.facts.map((f) => ({
      factType: f.factType,
      factText: f.factText,
      confidence: f.confidence,
    })),
    jobRequirements: input.jobRequirements,
    jobRubric: input.jobRubric,
    fromStatus: "parsed",
  });
  commands.push(...screenerResult.commands);
  agentRuns.push(screenerResult.agentRun);

  if (screenerResult.agentRun.run_status === "failed") {
    return { commands, agentRuns, finalStatus: "parsed", completed: false, failedAgent: "screening" };
  }

  // Stage 3: Interview Kit — decode screening output through schema validator
  let screeningOutput: ScreeningOutput;
  try {
    screeningOutput = decodeScreeningOutput(screenerResult.agentRun);
  } catch {
    return { commands, agentRuns, finalStatus: "screened", completed: false, failedAgent: "screening" };
  }

  const kitResult = await runInterviewKit(client, {
    candidateRecordId: input.candidateRecordId,
    jobRecordId: input.jobRecordId,
    candidateId: input.candidateId,
    jobId: input.jobId,
    resumeFacts: parserOutput.facts.map((f) => ({
      factType: f.factType,
      factText: f.factText,
      confidence: f.confidence,
    })),
    evaluationSummary: JSON.stringify({
      recommendation: screeningOutput.recommendation,
      dimensionRatings: screeningOutput.dimensionRatings,
    }),
    fromStatus: "screened",
  });
  commands.push(...kitResult.commands);
  agentRuns.push(kitResult.agentRun);

  if (kitResult.agentRun.run_status === "failed") {
    return { commands, agentRuns, finalStatus: "screened", completed: false, failedAgent: "interview_kit" };
  }

  // Stage 4: HR Coordinator — decode interview kit output through schema validator
  let kitOutput: InterviewKitOutput;
  try {
    kitOutput = decodeKitOutput(kitResult.agentRun);
  } catch {
    return { commands, agentRuns, finalStatus: "interview_kit_ready", completed: false, failedAgent: "interview_kit" };
  }

  const coordinatorResult = await runHrCoordinator(client, {
    candidateRecordId: input.candidateRecordId,
    candidateId: input.candidateId,
    jobId: input.jobId,
    screeningRecommendation: screeningOutput.recommendation,
    focusAreas: kitOutput.focusAreas,
    riskChecks: kitOutput.riskChecks,
    fromStatus: "interview_kit_ready",
  });
  commands.push(...coordinatorResult.commands);
  agentRuns.push(coordinatorResult.agentRun);

  if (coordinatorResult.agentRun.run_status === "failed") {
    return { commands, agentRuns, finalStatus: "interview_kit_ready", completed: false, failedAgent: "hr_coordinator" };
  }

  return { commands, agentRuns, finalStatus: "decision_pending", completed: true };
}
