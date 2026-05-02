import type { LlmClient } from "../llm/client.js";
import { parseHrCoordinatorOutput, type HrCoordinatorOutput } from "./schemas.js";
import { computePromptHash, buildAgentRun, completeWithSchemaRetry, type AgentResult } from "./base-agent.js";
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
  fromStatus: "interview_kit_ready" | "decision_pending";
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
  let runStatus: "success" | "failed" | "retried" = "success";
  let errorMessage: string | undefined;
  let durationMs = 0;
  let retryCount = 0;

  try {
    const result = await completeWithSchemaRetry(
      client,
      promptTemplateId,
      prompt,
      (raw) => parseHrCoordinatorOutput(raw),
    );
    parsed = result.parsed;
    durationMs = result.durationMs;
    retryCount = result.retryCount;
    if (retryCount > 0) runStatus = "retried";
  } catch (err) {
    runStatus = "failed";
    errorMessage = sanitizeErrorMessage(err instanceof Error ? err.message : String(err), input);
  }

  const statusAfter = runStatus === "failed" ? input.fromStatus : "decision_pending" as const;

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
    retryCount,
    durationMs,
  });

  const commands: BaseCommandSpec[] = [];

  try {
    commands.push(appendAgentRun(agentRun));
  } catch {
    // Audit append must not prevent the rest of the flow
  }

  if (runStatus !== "failed") {
    try {
      // Status transition — skip if already at target (Reviewer may have advanced us)
      if (input.fromStatus !== "decision_pending") {
        commands.push(
          updateCandidateStatus({
            candidateRecordId: input.candidateRecordId,
            fromStatus: input.fromStatus,
            toStatus: "decision_pending",
            actor: "agent",
          }),
        );
      }
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
