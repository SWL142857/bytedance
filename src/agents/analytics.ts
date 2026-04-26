import type { LlmClient } from "../llm/client.js";
import { parseAnalyticsOutput, type AnalyticsOutput } from "./schemas.js";
import { computePromptHash, buildAgentRun, completeWithSchemaRetry, type AgentResult } from "./base-agent.js";
import { upsertRecord, appendAgentRun } from "../base/runtime.js";
import type { BaseCommandSpec } from "../base/commands.js";
import type { CandidateStatus, ScreeningRecommendation } from "../types/state.js";

export interface AnalyticsCandidateSnapshot {
  candidateId: string;
  status: CandidateStatus;
  screeningRecommendation: ScreeningRecommendation | null;
  talentPoolCandidate: boolean;
}

export interface AnalyticsEvaluationSnapshot {
  candidateId: string;
  dimension: string;
  rating: "strong" | "medium" | "weak";
  recommendation: ScreeningRecommendation;
  fairnessFlags: string[];
  talentPoolSignal: string | null;
}

export interface AnalyticsAgentRunSnapshot {
  agentName: string;
  runStatus: "success" | "failed" | "retried" | "skipped";
}

export interface AnalyticsInput {
  reportId: string;
  periodStart: string;
  periodEnd: string;
  candidates: AnalyticsCandidateSnapshot[];
  evaluations: AnalyticsEvaluationSnapshot[];
  agentRuns: AnalyticsAgentRunSnapshot[];
}

const FAILED_OUTPUT: AnalyticsOutput = {
  funnelSummary: "",
  qualitySummary: "",
  bottlenecks: [],
  talentPoolSuggestions: [],
  recommendations: [],
};

export async function runAnalytics(
  client: LlmClient,
  input: AnalyticsInput,
): Promise<AgentResult> {
  const promptTemplateId = "analytics_v1";
  const prompt = buildAnalyticsPrompt(input);
  const promptHash = computePromptHash(promptTemplateId, prompt);
  const inputSummary = buildInputSummary(input);

  let parsed: AnalyticsOutput = FAILED_OUTPUT;
  let runStatus: "success" | "failed" | "retried" = "success";
  let errorMessage: string | undefined;
  let durationMs = 0;
  let retryCount = 0;

  try {
    const result = await completeWithSchemaRetry(
      client,
      promptTemplateId,
      prompt,
      (raw) => parseAnalyticsOutput(raw),
    );
    parsed = result.parsed;
    durationMs = result.durationMs;
    retryCount = result.retryCount;
    if (retryCount > 0) runStatus = "retried";
  } catch (err) {
    runStatus = "failed";
    errorMessage = sanitizeErrorMessage(err instanceof Error ? err.message : String(err));
  }

  const agentRun = buildAgentRun({
    agentName: "analytics",
    entityType: "report",
    entityRef: input.reportId,
    inputSummary,
    outputJson: JSON.stringify(parsed),
    promptTemplateId,
    promptHash,
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
      commands.push(
        upsertRecord("reports", {
          report_id: input.reportId,
          period_start: input.periodStart,
          period_end: input.periodEnd,
          funnel_summary: parsed.funnelSummary,
          quality_summary: parsed.qualitySummary,
          bottlenecks: parsed.bottlenecks.join("\n"),
          talent_pool_suggestions: parsed.talentPoolSuggestions.join("\n"),
          recommendations: parsed.recommendations.join("\n"),
          created_by_agent: "analytics",
        }),
      );
    } catch (cmdErr) {
      return {
        commands: [appendAgentRun(buildAgentRun({
          agentName: "analytics",
          entityType: "report",
          entityRef: input.reportId,
          inputSummary,
          outputJson: JSON.stringify(FAILED_OUTPUT),
          promptTemplateId,
          promptHash,
          runStatus: "failed",
          errorMessage: cmdErr instanceof Error ? cmdErr.message : String(cmdErr),
          durationMs,
        }))],
        agentRun: buildAgentRun({
          agentName: "analytics",
          entityType: "report",
          entityRef: input.reportId,
          inputSummary,
          outputJson: JSON.stringify(FAILED_OUTPUT),
          promptTemplateId,
          promptHash,
          runStatus: "failed",
          errorMessage: cmdErr instanceof Error ? cmdErr.message : String(cmdErr),
          durationMs,
        }),
      };
    }
  }

  return { commands, agentRun };
}

function buildAnalyticsPrompt(input: AnalyticsInput): string {
  const statusDist = new Map<string, number>();
  for (const c of input.candidates) {
    statusDist.set(c.status, (statusDist.get(c.status) ?? 0) + 1);
  }
  const distStr = [...statusDist.entries()].map(([k, v]) => `${k}:${v}`).join(", ");
  const failedRuns = input.agentRuns.filter((r) => r.runStatus === "failed").length;
  return `Generate recruitment report for period ${input.periodStart} to ${input.periodEnd}. ` +
    `Candidates: ${input.candidates.length} (${distStr}). Evaluations: ${input.evaluations.length}. ` +
    `Agent runs: ${input.agentRuns.length} (${failedRuns} failed).`;
}

function buildInputSummary(input: AnalyticsInput): string {
  const statusDist = new Map<string, number>();
  for (const c of input.candidates) {
    statusDist.set(c.status, (statusDist.get(c.status) ?? 0) + 1);
  }
  const distStr = [...statusDist.entries()].map(([k, v]) => `${k}:${v}`).join(",");
  return `period=${input.periodStart}~${input.periodEnd} candidates=${input.candidates.length} [${distStr}] evaluations=${input.evaluations.length} agentRuns=${input.agentRuns.length}`;
}

function sanitizeErrorMessage(msg: string): string {
  let sanitized = msg;
  if (sanitized.length > 500) {
    sanitized = sanitized.slice(0, 500);
  }
  return sanitized;
}
