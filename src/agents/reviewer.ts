import type { LlmClient } from "../llm/client.js";
import { parseReviewerOutput, type ReviewerOutput } from "./schemas.js";
import { computePromptHash, buildAgentRun, completeWithSchemaRetry, type AgentResult } from "./base-agent.js";
import { upsertRecord, updateCandidateStatus, appendAgentRun } from "../base/runtime.js";
import { assertLarkRecordId } from "../base/record-values.js";
import type { BaseCommandSpec } from "../base/commands.js";

export interface ReviewerInput {
  candidateRecordId: string;
  jobRecordId: string;
  candidateId: string;
  jobId: string;
  // Six signal types from Competition REVIEWER_AGENT_PROMPT:
  roleMemory: string;                    // Role-level hiring patterns
  candidateProfile: string;              // Structured extraction summary
  graphProjection: {                     // Deterministic projection
    label: string;
    confidence: number;
    graphScore: number;
    reviewMode: string;
    signalSummary: string;
    neighborCount: number;
  } | null;
  gnnSignal: {                           // GNN calibration
    selectProbability: number;
    effectivePrediction: string;
  } | null;
  topNeighbors: Array<{                  // Top similar candidates
    candidateId: string;
    decision: string;
    similarityScore: number;
    reason: string;
  }>;
  fromStatus: "screened" | "interview_kit_ready";
}

const FAILED_OUTPUT: ReviewerOutput = {
  decisionPred: "reject",
  confidence: 0.5,
  reasonLabel: "Review Failed",
  reasonGroup: "error",
  reviewSummary: "Reviewer agent encountered an error. Manual review required.",
};

// Adapted from Competition REVIEWER_AGENT_PROMPT
const REVIEWER_PROMPT = `You are the Reviewer Agent for a hiring memory graph system.
You make the final hiring recommendation based on accumulated memory from the graph.

## Inputs You Receive
1. Role memory — what the system has learned from previously reviewed candidates (accept/reject patterns)
2. Candidate profile — structured extraction output
3. Graph projection — deterministic Python-computed score, mode, label, confidence, and neighbor evidence
4. GNN calibration signal — learned select probability (auxiliary prior only)
5. Top neighbors — most similar candidates with their past decisions and reasons

## Decision Rules
- Treat graph_projection as the authoritative numeric projection. Do not recalculate.
- Treat gnn_signal as auxiliary calibration, not replacement for explicit evidence.
- If projection review_mode is "semantic_fallback_review", rely primarily on resume/JD evidence.
- Use neighbor decisions as calibration signals: neighbor rejection = warning, neighbor selection = positive.
- Prioritize explicit evidence in the candidate profile over inferred patterns.
- Confidence: 0.9–1.0=overwhelming, 0.7–0.89=clear lean, 0.5–0.69=mixed signals, <0.5=inconclusive.

## Output Format
{
  "decisionPred": "select|reject",
  "confidence": 0.0,
  "reasonLabel": "<short label>",
  "reasonGroup": "skill_match|experience_gap|risk_signal|mixed_evidence|error",
  "reviewSummary": "<2-4 sentence explanation referencing specific evidence>"
}`;

function buildReviewerPrompt(input: ReviewerInput): string {
  const parts: string[] = [REVIEWER_PROMPT, "\n---\n"];

  parts.push(`ROLE MEMORY: ${input.roleMemory}`);
  parts.push(`CANDIDATE PROFILE: ${input.candidateProfile}`);

  if (input.graphProjection) {
    const gp = input.graphProjection;
    parts.push(
      `GRAPH PROJECTION: label=${gp.label} confidence=${gp.confidence} graphScore=${gp.graphScore} ` +
      `reviewMode=${gp.reviewMode} neighborCount=${gp.neighborCount} summary=${gp.signalSummary}`,
    );
  } else {
    parts.push("GRAPH PROJECTION: not available");
  }

  if (input.gnnSignal) {
    parts.push(`GNN SIGNAL: selectProbability=${input.gnnSignal.selectProbability} effectivePrediction=${input.gnnSignal.effectivePrediction}`);
  } else {
    parts.push("GNN SIGNAL: not available");
  }

  if (input.topNeighbors.length > 0) {
    const neighborLines = input.topNeighbors.map(
      (n) => `  - ${n.candidateId}: ${n.decision} (${n.similarityScore}) — ${n.reason}`,
    );
    parts.push(`TOP NEIGHBORS:\n${neighborLines.join("\n")}`);
  } else {
    parts.push("TOP NEIGHBORS: none");
  }

  return parts.join("\n");
}

export async function runReviewer(
  client: LlmClient,
  input: ReviewerInput,
): Promise<AgentResult> {
  assertLarkRecordId("candidateRecordId", input.candidateRecordId);
  assertLarkRecordId("jobRecordId", input.jobRecordId);

  const promptTemplateId = "reviewer_v1";
  const prompt = buildReviewerPrompt(input);
  const promptHash = computePromptHash(promptTemplateId, prompt);
  const inputSummary = `candidateId=${input.candidateId} jobId=${input.jobId} status=${input.fromStatus}`;

  let parsed: ReviewerOutput = FAILED_OUTPUT;
  let runStatus: "success" | "failed" | "retried" = "success";
  let errorMessage: string | undefined;
  let durationMs = 0;
  let retryCount = 0;

  try {
    const result = await completeWithSchemaRetry(
      client,
      promptTemplateId,
      prompt,
      (raw) => parseReviewerOutput(raw),
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

  const statusAfter = runStatus === "failed" ? input.fromStatus : "decision_pending";

  const agentRun = buildAgentRun({
    agentName: "screening_reviewer",
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
      commands.push(
        upsertRecord("evaluations", {
          candidate: [{ id: input.candidateRecordId }],
          job: [{ id: input.jobRecordId }],
          dimension: "graph_reviewer",
          rating: parsed.decisionPred === "select" ? "strong" : "weak",
          recommendation: parsed.decisionPred === "select" ? "strong_match" : "weak_match",
          reason: parsed.reviewSummary,
          evidence_refs: parsed.reasonLabel,
          fairness_flags: "",
          talent_pool_signal: null,
        }),
      );

      // Review decision goes to evaluations + screening_recommendation only.
      // resume_text is source-of-truth (set by Intake), never overwritten.
      commands.push(
        upsertRecord("candidates", {
          screening_recommendation: parsed.decisionPred === "select" ? "strong_match" : "weak_match",
        }, { recordId: input.candidateRecordId }),
      );

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
          agentName: "screening_reviewer",
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
          agentName: "screening_reviewer",
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
