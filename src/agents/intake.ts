import type { IntakeOutput } from "./schemas.js";
import { computePromptHash, buildAgentRun, type AgentResult } from "./base-agent.js";
import { updateCandidateStatus, appendAgentRun } from "../base/runtime.js";
import { assertLarkRecordId } from "../base/record-values.js";
import type { BaseCommandSpec } from "../base/commands.js";

export interface IntakeInput {
  candidateRecordId: string;
  jobRecordId: string;
  candidateId: string;
  jobId: string;
  resumeText: string;
  jobRequirements: string;
  fromStatus: "new";
}

// Intake is deterministic — no LLM call needed.
// Competition INTAKE_AGENT_PROMPT defines the behavior:
// "You preserve source text exactly as provided. You do NOT analyze, score, or infer."

function buildIntakeOutput(input: IntakeInput): IntakeOutput {
  return {
    candidateId: input.candidateId,
    resumeRaw: input.resumeText,
    targetRole: input.jobId,
    jobDescriptionRaw: input.jobRequirements,
    intakeTimestamp: new Date().toISOString(),
    sourceMetadata: {
      submissionChannel: "api",
      languageDetected: "unknown",
      charCount: input.resumeText.length,
    },
  };
}

export async function runIntake(input: IntakeInput): Promise<AgentResult> {
  assertLarkRecordId("candidateRecordId", input.candidateRecordId);
  assertLarkRecordId("jobRecordId", input.jobRecordId);

  const output = buildIntakeOutput(input);
  const promptTemplateId = "intake_v1";
  const prompt = buildIntakeRecord(input);
  const promptHash = computePromptHash(promptTemplateId, prompt);
  const inputSummary = `candidateId=${input.candidateId} jobId=${input.jobId} status=${input.fromStatus}`;
  const durationMs = 0; // deterministic

  const agentRun = buildAgentRun({
    agentName: "resume_intake",
    entityType: "candidate",
    entityRef: input.candidateId,
    inputSummary,
    outputJson: JSON.stringify(output),
    promptTemplateId,
    promptHash,
    statusBefore: input.fromStatus,
    statusAfter: "parsed",
    runStatus: "success",
    durationMs,
  });

  const commands: BaseCommandSpec[] = [];
  try { commands.push(appendAgentRun(agentRun)); } catch { /* audit append */ }

  try {
    commands.push(
      updateCandidateStatus({
        candidateRecordId: input.candidateRecordId,
        fromStatus: input.fromStatus,
        toStatus: "parsed",
        actor: "agent",
      }),
    );
  } catch (cmdErr) {
    return {
      commands: [appendAgentRun(buildAgentRun({
        agentName: "resume_intake",
        entityType: "candidate",
        entityRef: input.candidateId,
        inputSummary,
        outputJson: JSON.stringify(output),
        promptTemplateId,
        promptHash,
        statusBefore: input.fromStatus,
        statusAfter: input.fromStatus,
        runStatus: "failed",
        errorMessage: cmdErr instanceof Error ? cmdErr.message : String(cmdErr),
        durationMs,
      }))],
      agentRun: buildAgentRun({
        agentName: "resume_intake",
        entityType: "candidate",
        entityRef: input.candidateId,
        inputSummary,
        outputJson: JSON.stringify(output),
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

  return { commands, agentRun };
}

function buildIntakeRecord(input: IntakeInput): string {
  return `INTAKE candidateId=${input.candidateId} jobId=${input.jobId} resumeLen=${input.resumeText.length}`;
}
