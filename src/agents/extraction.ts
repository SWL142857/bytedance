import type { LlmClient } from "../llm/client.js";
import { parseExtractionOutput, type ExtractionOutput } from "./schemas.js";
import { computePromptHash, buildAgentRun, completeWithSchemaRetry, type AgentResult } from "./base-agent.js";
import { upsertRecord, updateCandidateStatus, appendAgentRun } from "../base/runtime.js";
import { assertLarkRecordId } from "../base/record-values.js";
import type { BaseCommandSpec } from "../base/commands.js";

export interface ExtractionInput {
  candidateRecordId: string;
  jobRecordId: string;
  candidateId: string;
  jobId: string;
  resumeText: string;
  jobRequirements: string;
  fromStatus: "parsed";
}

const FAILED_OUTPUT: ExtractionOutput = {
  skills: [],
  features: [],
  profile: {
    yearsOfExperience: "unknown",
    educationLevel: "unknown",
    industryBackground: "unknown",
    leadershipLevel: "unknown",
    communicationLevel: "unknown",
    systemDesignLevel: "unknown",
    structuredSummary: "Extraction failed.",
  },
};

// Adapted from Competition EXTRACTION_AGENT_PROMPT
const EXTRACTION_PROMPT = `You are the Extraction Agent for a hiring memory graph system.
Given a candidate resume, target role, and job description, your job is to extract structured, grounded facts.

## Rules
- Extract only what is explicitly stated or strongly implied by direct evidence.
- Normalize skill names to canonical labels (e.g. "Python 3" → "Python").
- Assign confidence 0.0–1.0: 1.0=explicit, 0.7–0.9=clearly implied, 0.4–0.6=weakly inferred.
- Below 0.4 = omit entirely. Unknown fields = "unknown". Never fabricate.
- Output ONLY valid JSON, no markdown fences.

## Output Format
{
  "skills": [{"name": "...", "canonicalName": "...", "confidence": 0.0, "evidence": "..."}],
  "features": [
    {"featureType": "capability|education|industry|experience|risk", "featureName": "...", "canonicalName": "...", "featureValue": "...", "confidence": 0.0, "evidence": "..."}
  ],
  "profile": {
    "yearsOfExperience": "...",
    "educationLevel": "...",
    "industryBackground": "...",
    "leadershipLevel": "<none|junior|mid|senior|executive|unknown>",
    "communicationLevel": "<none|basic|proficient|strong|unknown>",
    "systemDesignLevel": "<none|basic|proficient|strong|unknown>",
    "structuredSummary": "..."
  }
}

## Feature Types
- capability: What the candidate can do
- education: Degrees, certifications
- industry: Domain experience
- experience: Tenure, scope, impact
- risk: Potential concerns`;

export async function runExtraction(
  client: LlmClient,
  input: ExtractionInput,
): Promise<AgentResult> {
  assertLarkRecordId("candidateRecordId", input.candidateRecordId);
  assertLarkRecordId("jobRecordId", input.jobRecordId);

  const promptTemplateId = "extraction_v1";
  const prompt = `${EXTRACTION_PROMPT}\n\n---\n\nTARGET ROLE: ${input.jobId}\nJOB DESCRIPTION: ${input.jobRequirements}\nRESUME: ${input.resumeText}`;
  const promptHash = computePromptHash(promptTemplateId, prompt);
  const inputSummary = `candidateId=${input.candidateId} jobId=${input.jobId} resumeLen=${input.resumeText.length}`;

  let parsed: ExtractionOutput = FAILED_OUTPUT;
  let runStatus: "success" | "failed" | "retried" = "success";
  let errorMessage: string | undefined;
  let durationMs = 0;
  let retryCount = 0;

  try {
    const result = await completeWithSchemaRetry(
      client,
      promptTemplateId,
      prompt,
      (raw) => parseExtractionOutput(raw),
    );
    parsed = result.parsed;
    durationMs = result.durationMs;
    retryCount = result.retryCount;
    if (retryCount > 0) runStatus = "retried";
  } catch (err) {
    durationMs = 0;
    runStatus = "failed";
    errorMessage = err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500);
  }

  const statusAfter = runStatus === "failed" ? input.fromStatus : "screened";

  const agentRun = buildAgentRun({
    agentName: "resume_extraction",
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
  try { commands.push(appendAgentRun(agentRun)); } catch { /* audit */ }

  if (runStatus !== "failed") {
    try {
      for (const skill of parsed.skills.slice(0, 5)) {
        commands.push(
          upsertRecord("resume_facts", {
            candidate: [{ id: input.candidateRecordId }],
            fact_type: "skill",
            fact_text: `${skill.canonicalName}: ${skill.evidence}`.slice(0, 500),
            source_excerpt: skill.evidence.slice(0, 200),
            confidence: skill.confidence >= 0.8 ? "high" : skill.confidence >= 0.5 ? "medium" : "low",
            created_by_agent: "resume_extraction",
          }),
        );
      }
      for (const feature of parsed.features.slice(0, 5)) {
        const mappedType = mapFeatureType(feature.featureType);
        if (!mappedType) continue;
        commands.push(
          upsertRecord("resume_facts", {
            candidate: [{ id: input.candidateRecordId }],
            fact_type: mappedType,
            fact_text: `${feature.canonicalName}: ${feature.featureValue}`.slice(0, 500),
            source_excerpt: feature.evidence.slice(0, 200),
            confidence: feature.confidence >= 0.8 ? "high" : feature.confidence >= 0.5 ? "medium" : "low",
            created_by_agent: "resume_extraction",
          }),
        );
      }

      // Extraction facts go to resume_facts table only — resume_text is source-of-truth
      // set by Intake and must not be overwritten by downstream agents.

      commands.push(
        updateCandidateStatus({
          candidateRecordId: input.candidateRecordId,
          fromStatus: input.fromStatus,
          toStatus: "screened",
          actor: "agent",
        }),
      );
    } catch (cmdErr) {
      return {
        commands: [appendAgentRun(buildAgentRun({
          agentName: "resume_extraction",
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
          agentName: "resume_extraction",
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

// Map competition feature types to valid Base schema fact_types
function mapFeatureType(ft: string): "skill" | "education" | "work_experience" | "other" | null {
  switch (ft) {
    case "capability": return "skill";
    case "education": return "education";
    case "experience": return "work_experience";
    case "industry": return "other";
    case "risk": return "other";
    default: return "other";
  }
}
