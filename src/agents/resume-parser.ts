import type { LlmClient } from "../llm/client.js";
import { parseResumeParserOutput, type ResumeParserOutput } from "./schemas.js";
import { callLlm, computePromptHash, buildAgentRun, type AgentResult } from "./base-agent.js";
import { upsertRecord, updateCandidateStatus, appendAgentRun } from "../base/runtime.js";
import { assertLarkRecordId } from "../base/record-values.js";
import type { BaseCommandSpec } from "../base/commands.js";

export interface ResumeParserInput {
  candidateRecordId: string;
  candidateId: string;
  resumeText: string;
  fromStatus: "new";
}

const FAILED_OUTPUT: ResumeParserOutput = {
  facts: [],
  parseStatus: "failed",
  errorMessage: "Agent processing failed",
};

export async function runResumeParser(
  client: LlmClient,
  input: ResumeParserInput,
): Promise<AgentResult> {
  assertLarkRecordId("candidateRecordId", input.candidateRecordId);

  const promptTemplateId = "resume_parser_v1";
  const prompt = buildResumeParserPrompt(input);
  const promptHash = computePromptHash(promptTemplateId, prompt);
  const inputSummary = buildInputSummary(input);

  let parsed: ResumeParserOutput = FAILED_OUTPUT;
  let runStatus: "success" | "failed" = "success";
  let errorMessage: string | undefined;
  let durationMs = 0;

  try {
    const { response, durationMs: dur } = await callLlm(client, { promptTemplateId, prompt });
    durationMs = dur;
    const raw = JSON.parse(response.content);
    parsed = parseResumeParserOutput(raw);
  } catch (err) {
    runStatus = "failed";
    errorMessage = sanitizeErrorMessage(err instanceof Error ? err.message : String(err), input);
  }

  const commands: BaseCommandSpec[] = [];
  let statusAfter: "new" | "parsed" = input.fromStatus;

  // Handle parseStatus=failed from model (schema valid but content says failure)
  if (runStatus === "success" && parsed.parseStatus === "failed") {
    runStatus = "failed";
    errorMessage = sanitizeErrorMessage(parsed.errorMessage || "Resume parsing failed", input);
  }

  if (runStatus === "success") {
    statusAfter = "parsed";
  }

  const agentRun = buildAgentRun({
    agentName: "resume_parser",
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

  try {
    commands.push(appendAgentRun(agentRun));
  } catch {
    // Audit append must not prevent the rest of the flow
  }

  if (runStatus === "success") {
    try {
      for (const fact of parsed.facts) {
        commands.push(
          upsertRecord("resume_facts", {
            candidate: [{ id: input.candidateRecordId }],
            fact_type: fact.factType,
            fact_text: fact.factText,
            source_excerpt: fact.sourceExcerpt,
            confidence: fact.confidence,
            created_by_agent: "resume_parser",
          }),
        );
      }

      commands.push(
        updateCandidateStatus({
          candidateRecordId: input.candidateRecordId,
          fromStatus: input.fromStatus,
          toStatus: "parsed",
          actor: "agent",
        }),
      );
    } catch (cmdErr) {
      // Command build failed — downgrade to failed run
      return {
        commands: [appendAgentRun(buildAgentRun({
          agentName: "resume_parser",
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
          agentName: "resume_parser",
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

function buildResumeParserPrompt(input: ResumeParserInput): string {
  return `Extract structured facts from the following resume for candidate ${input.candidateId}. Resume length: ${input.resumeText.length} chars.`;
}

function buildInputSummary(input: ResumeParserInput): string {
  return `candidateId=${input.candidateId} resumeLength=${input.resumeText.length} status=${input.fromStatus}`;
}

function sanitizeErrorMessage(msg: string, input: ResumeParserInput): string {
  let sanitized = msg;
  if (input.resumeText && sanitized.includes(input.resumeText)) {
    sanitized = sanitized.replaceAll(input.resumeText, "[redacted]");
  }
  if (sanitized.length > 500) {
    sanitized = sanitized.slice(0, 500);
  }
  return sanitized;
}
