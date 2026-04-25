import type { LlmClient } from "../llm/client.js";
import { parseInterviewKitOutput, type InterviewKitOutput } from "./schemas.js";
import { callLlm, computePromptHash, buildAgentRun, type AgentResult } from "./base-agent.js";
import { upsertRecord, updateCandidateStatus, appendAgentRun } from "../base/runtime.js";
import { assertLarkRecordId } from "../base/record-values.js";
import type { BaseCommandSpec } from "../base/commands.js";

export interface InterviewKitInput {
  candidateRecordId: string;
  jobRecordId: string;
  candidateId: string;
  jobId: string;
  resumeFacts: Array<{
    factType: string;
    factText: string;
    confidence: string;
  }>;
  evaluationSummary: string;
  fromStatus: "screened";
}

const FAILED_OUTPUT: InterviewKitOutput = {
  questions: [],
  scorecardDimensions: [],
  focusAreas: [],
  riskChecks: [],
};

export async function runInterviewKit(
  client: LlmClient,
  input: InterviewKitInput,
): Promise<AgentResult> {
  assertLarkRecordId("candidateRecordId", input.candidateRecordId);
  assertLarkRecordId("jobRecordId", input.jobRecordId);

  const promptTemplateId = "interview_kit_v1";
  const prompt = buildInterviewKitPrompt(input);
  const promptHash = computePromptHash(promptTemplateId, prompt);
  const inputSummary = buildInputSummary(input);

  let parsed: InterviewKitOutput = FAILED_OUTPUT;
  let runStatus: "success" | "failed" = "success";
  let errorMessage: string | undefined;
  let durationMs = 0;

  try {
    const { response, durationMs: dur } = await callLlm(client, { promptTemplateId, prompt });
    durationMs = dur;
    const raw = JSON.parse(response.content);
    parsed = parseInterviewKitOutput(raw);
  } catch (err) {
    runStatus = "failed";
    errorMessage = sanitizeErrorMessage(err instanceof Error ? err.message : String(err), input);
  }

  const statusAfter = runStatus === "success" ? "interview_kit_ready" as const : input.fromStatus;

  const agentRun = buildAgentRun({
    agentName: "interview_kit",
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

  // Agent Run goes first to preserve audit trail
  try {
    commands.push(appendAgentRun(agentRun));
  } catch {
    // Audit append must not prevent the rest of the flow
  }

  if (runStatus === "success") {
    try {
      commands.push(
        upsertRecord("interview_kits", {
          candidate: [{ id: input.candidateRecordId }],
          job: [{ id: input.jobRecordId }],
          question_list: JSON.stringify(parsed.questions),
          scorecard: parsed.scorecardDimensions.join(", "),
          focus_areas: parsed.focusAreas.join(", "),
          risk_checks: parsed.riskChecks.join(", "),
          created_by_agent: "interview_kit",
        }),
      );

      // Status transition is the last business write
      commands.push(
        updateCandidateStatus({
          candidateRecordId: input.candidateRecordId,
          fromStatus: input.fromStatus,
          toStatus: "interview_kit_ready",
          actor: "agent",
        }),
      );
    } catch (cmdErr) {
      return {
        commands: [appendAgentRun(buildAgentRun({
          agentName: "interview_kit",
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
          agentName: "interview_kit",
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

function buildInterviewKitPrompt(input: InterviewKitInput): string {
  const factsStr = input.resumeFacts.map((f) => `${f.factType}: ${f.factText}`).join("; ");
  return `Generate interview kit for candidate ${input.candidateId} and job ${input.jobId}. ` +
    `Facts: ${factsStr}. Evaluation summary length: ${input.evaluationSummary.length} chars.`;
}

function buildInputSummary(input: InterviewKitInput): string {
  return `candidateId=${input.candidateId} jobId=${input.jobId} facts=${input.resumeFacts.length} evalSummaryLength=${input.evaluationSummary.length} status=${input.fromStatus}`;
}

function sanitizeErrorMessage(msg: string, input: InterviewKitInput): string {
  let sanitized = msg;
  if (input.evaluationSummary && sanitized.includes(input.evaluationSummary)) {
    sanitized = sanitized.replaceAll(input.evaluationSummary, "[redacted]");
  }
  for (const fact of input.resumeFacts) {
    if (fact.factText && sanitized.includes(fact.factText)) {
      sanitized = sanitized.replaceAll(fact.factText, "[redacted]");
    }
  }
  if (sanitized.length > 500) {
    sanitized = sanitized.slice(0, 500);
  }
  return sanitized;
}
