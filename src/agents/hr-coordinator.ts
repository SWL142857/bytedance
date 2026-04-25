import type { LlmClient } from "../llm/client.js";
import { parseHrCoordinatorOutput, type HrCoordinatorOutput } from "./schemas.js";
import { callLlm, computePromptHash, buildAgentRun, type AgentResult } from "./base-agent.js";
import { updateCandidateStatus, appendAgentRun } from "../base/runtime.js";
import { assertLarkRecordId } from "../base/record-values.js";
import type { BaseCommandSpec } from "../base/commands.js";

export interface HrCoordinatorInput {
  candidateRecordId: string;
  candidateId: string;
  jobId: string;
  screeningRecommendation: "strong_match" | "review_needed" | "weak_match" | null;
  focusAreas: string[];
  riskChecks: string[];
  fromStatus: "interview_kit_ready";
}

const FAILED_OUTPUT: HrCoordinatorOutput = {
  handoffSummary: "",
  nextStep: "human_decision",
  coordinatorChecklist: [],
};

export async function runHrCoordinator(
  client: LlmClient,
  input: HrCoordinatorInput,
): Promise<AgentResult> {
  assertLarkRecordId("candidateRecordId", input.candidateRecordId);

  const promptTemplateId = "hr_coordinator_v1";
  const prompt = buildHrCoordinatorPrompt(input);
  const promptHash = computePromptHash(promptTemplateId, prompt);
  const inputSummary = buildInputSummary(input);

  let parsed: HrCoordinatorOutput = FAILED_OUTPUT;
  let runStatus: "success" | "failed" = "success";
  let errorMessage: string | undefined;
  let durationMs = 0;

  try {
    const { response, durationMs: dur } = await callLlm(client, { promptTemplateId, prompt });
    durationMs = dur;
    const raw = JSON.parse(response.content);
    parsed = parseHrCoordinatorOutput(raw);
  } catch (err) {
    runStatus = "failed";
    errorMessage = sanitizeErrorMessage(err instanceof Error ? err.message : String(err), input);
  }

  const statusAfter = runStatus === "success" ? "decision_pending" as const : input.fromStatus;

  const agentRun = buildAgentRun({
    agentName: "hr_coordinator",
    entityType: "candidate",
    entityRef: input.candidateId,
    inputSummary,
    outputJson: JSON.stringify(parsed),
    promptTemplateId,
    promptHash,
    statusBefore: input.fromStatus,
    statusAfter,
    runStatus,
    errorMessage,
    durationMs,
  });

  const commands: BaseCommandSpec[] = [];

  try {
    commands.push(appendAgentRun(agentRun));
  } catch {
    // Audit append must not prevent the rest of the flow
  }

  if (runStatus === "success") {
    try {
      // Status transition is the last (and only business) write
      commands.push(
        updateCandidateStatus({
          candidateRecordId: input.candidateRecordId,
          fromStatus: input.fromStatus,
          toStatus: "decision_pending",
          actor: "agent",
        }),
      );
    } catch (cmdErr) {
      return {
        commands: [appendAgentRun(buildAgentRun({
          agentName: "hr_coordinator",
          entityType: "candidate",
          entityRef: input.candidateId,
          inputSummary,
          outputJson: JSON.stringify(FAILED_OUTPUT),
          promptTemplateId,
          promptHash,
          statusBefore: input.fromStatus,
          statusAfter: input.fromStatus,
          runStatus: "failed",
          errorMessage: cmdErr instanceof Error ? cmdErr.message : String(cmdErr),
          durationMs,
        }))],
        agentRun: buildAgentRun({
          agentName: "hr_coordinator",
          entityType: "candidate",
          entityRef: input.candidateId,
          inputSummary,
          outputJson: JSON.stringify(FAILED_OUTPUT),
          promptTemplateId,
          promptHash,
          statusBefore: input.fromStatus,
          statusAfter: input.fromStatus,
          runStatus: "failed",
          errorMessage: cmdErr instanceof Error ? cmdErr.message : String(cmdErr),
          durationMs,
        }),
      };
    }
  }

  return { commands, agentRun };
}

function buildHrCoordinatorPrompt(input: HrCoordinatorInput): string {
  const recommendation = input.screeningRecommendation ?? "none";
  return `Coordinate handoff for candidate ${input.candidateId} job ${input.jobId}. ` +
    `Screening: ${recommendation}. Focus areas: ${input.focusAreas.length}. Risk checks: ${input.riskChecks.length}.`;
}

function buildInputSummary(input: HrCoordinatorInput): string {
  const recommendation = input.screeningRecommendation ?? "none";
  return `candidateId=${input.candidateId} jobId=${input.jobId} screening=${recommendation} focusAreas=${input.focusAreas.length} riskChecks=${input.riskChecks.length} status=${input.fromStatus}`;
}

function sanitizeErrorMessage(msg: string, input: HrCoordinatorInput): string {
  let sanitized = msg;
  for (const item of input.focusAreas) {
    if (item && sanitized.includes(item)) {
      sanitized = sanitized.replaceAll(item, "[redacted]");
    }
  }
  for (const item of input.riskChecks) {
    if (item && sanitized.includes(item)) {
      sanitized = sanitized.replaceAll(item, "[redacted]");
    }
  }
  if (sanitized.length > 500) {
    sanitized = sanitized.slice(0, 500);
  }
  return sanitized;
}
