import type { LlmClient } from "../llm/client.js";
import { parseScreeningOutput, type ScreeningOutput } from "./schemas.js";
import { computePromptHash, buildAgentRun, completeWithSchemaRetry, type AgentResult } from "./base-agent.js";
import { upsertRecord, updateCandidateStatus, appendAgentRun } from "../base/runtime.js";
import { assertLarkRecordId } from "../base/record-values.js";
import type { BaseCommandSpec } from "../base/commands.js";

export interface ScreeningInput {
  candidateRecordId: string;
  jobRecordId: string;
  candidateId: string;
  jobId: string;
  resumeFacts: Array<{
    factType: string;
    factText: string;
    confidence: string;
  }>;
  jobRequirements: string;
  jobRubric: string;
  fromStatus: "parsed";
}

const FAILED_OUTPUT: ScreeningOutput = {
  recommendation: "review_needed",
  dimensionRatings: [],
  fairnessFlags: [],
  talentPoolSignal: null,
};

export async function runScreener(
  client: LlmClient,
  input: ScreeningInput,
): Promise<AgentResult> {
  assertLarkRecordId("candidateRecordId", input.candidateRecordId);
  assertLarkRecordId("jobRecordId", input.jobRecordId);

  const promptTemplateId = "screening_v1";
  const prompt = buildScreenerPrompt(input);
  const promptHash = computePromptHash(promptTemplateId, prompt);
  const inputSummary = buildInputSummary(input);

  let parsed: ScreeningOutput = FAILED_OUTPUT;
  let runStatus: "success" | "failed" | "retried" = "success";
  let errorMessage: string | undefined;
  let durationMs = 0;
  let retryCount = 0;

  try {
    const result = await completeWithSchemaRetry(
      client,
      promptTemplateId,
      prompt,
      (raw) => parseScreeningOutput(raw),
    );
    parsed = result.parsed;
    durationMs = result.durationMs;
    retryCount = result.retryCount;
    if (retryCount > 0) runStatus = "retried";
  } catch (err) {
    durationMs = 0;
    runStatus = "failed";
    errorMessage = sanitizeErrorMessage(err instanceof Error ? err.message : String(err), input);
  }

  const statusAfter = runStatus === "failed" ? input.fromStatus : "screened";

  const agentRun = buildAgentRun({
    agentName: "screening",
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

  // Agent Run goes first to preserve audit trail
  try {
    commands.push(appendAgentRun(agentRun));
  } catch {
    // Audit append must not prevent the rest of the flow
  }

  if (runStatus !== "failed") {
    try {
      for (const dr of parsed.dimensionRatings) {
        commands.push(
          upsertRecord("evaluations", {
            candidate: [{ id: input.candidateRecordId }],
            job: [{ id: input.jobRecordId }],
            dimension: dr.dimension,
            rating: dr.rating,
            recommendation: parsed.recommendation,
            reason: dr.reason,
            evidence_refs: dr.evidenceRefs.join(","),
            fairness_flags: parsed.fairnessFlags.join(","),
            talent_pool_signal: parsed.talentPoolSignal,
          }),
        );
      }

      commands.push(
        upsertRecord("candidates", {
          screening_recommendation: parsed.recommendation,
          talent_pool_candidate: parsed.talentPoolSignal !== null,
        }, { recordId: input.candidateRecordId }),
      );

      // Status transition is the last business write
      commands.push(
        updateCandidateStatus({
          candidateRecordId: input.candidateRecordId,
          fromStatus: input.fromStatus,
          toStatus: "screened",
          actor: "agent",
        }),
      );
    } catch (cmdErr) {
      // Command build failed — return only the agent run audit
      return {
        commands: [appendAgentRun(buildAgentRun({
          agentName: "screening",
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
          agentName: "screening",
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

function buildScreenerPrompt(input: ScreeningInput): string {
  const factsStr = input.resumeFacts.map((f) => `${f.factType}: ${f.factText}`).join("; ");
  return `Screen candidate ${input.candidateId} for job ${input.jobId}. ` +
    `Requirements: ${input.jobRequirements}. Rubric: ${input.jobRubric}. Facts: ${factsStr}.`;
}

function buildInputSummary(input: ScreeningInput): string {
  return `candidateId=${input.candidateId} jobId=${input.jobId} facts=${input.resumeFacts.length} status=${input.fromStatus}`;
}

function sanitizeErrorMessage(msg: string, input: ScreeningInput): string {
  let sanitized = msg;
  const sensitiveParts = [input.jobRequirements, input.jobRubric];
  for (const part of sensitiveParts) {
    if (part && sanitized.includes(part)) {
      sanitized = sanitized.replaceAll(part, "[redacted]");
    }
  }
  if (sanitized.length > 500) {
    sanitized = sanitized.slice(0, 500);
  }
  return sanitized;
}
