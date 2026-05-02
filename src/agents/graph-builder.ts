import type { LlmClient } from "../llm/client.js";
import { parseGraphBuilderOutput, type GraphBuilderOutput } from "./schemas.js";
import { computePromptHash, buildAgentRun, completeWithSchemaRetry, type AgentResult } from "./base-agent.js";
import { appendAgentRun } from "../base/runtime.js";
import type { BaseCommandSpec } from "../base/commands.js";

export interface GraphBuilderCandidate {
  candidateId: string;
  skills: string[];
  features: Array<{ featureType: string; canonicalName: string; featureValue: string }>;
  summary: string;
  leadershipLevel: string;
  systemDesignLevel: string;
  educationLevel: string;
  yearsOfExperience: string;
}

export interface GraphBuilderInput {
  candidateA: GraphBuilderCandidate;
  candidateB: GraphBuilderCandidate;
  jobId: string;
}

const FAILED_OUTPUT: GraphBuilderOutput = {
  shouldLink: false,
  linkReason: "Graph builder unavailable — skip edge creation.",
  sharedSignals: [],
};

// Adapted from Competition GRAPH_BUILDER_AGENT_PROMPT
const GRAPH_BUILDER_PROMPT = `You are the Graph Builder Agent for a hiring memory graph system.
Determine whether two candidates applying for the same role should be linked as neighbors.

## Linking Criteria (link if at least one holds)
1. Overlapping canonical skills (2+ shared skills with confidence ≥ 0.7)
2. Same education level + similar experience band
3. Shared feature type with similar value (e.g. both have "Tenure Risk")
4. Aligned profile fields: same leadership_level + same system_design_level
5. Similar structured summary themes

Do NOT link just because they apply to the same role.

## Output Format
{
  "shouldLink": true | false,
  "linkReason": "<one or two sentences using only observed features>",
  "sharedSignals": ["<canonicalName>", ...]
}`;

function describeCandidate(c: GraphBuilderCandidate): string {
  return [
    `Skills: ${c.skills.join(", ")}`,
    `Features: ${c.features.map((f) => `${f.featureType}:${f.canonicalName}=${f.featureValue}`).join("; ")}`,
    `Profile: ${c.yearsOfExperience}y exp, ${c.educationLevel}, leadership=${c.leadershipLevel}, sysDesign=${c.systemDesignLevel}`,
    `Summary: ${c.summary}`,
  ].join("\n");
}

export async function runGraphBuilder(
  client: LlmClient,
  input: GraphBuilderInput,
): Promise<AgentResult> {
  const promptTemplateId = "graph_builder_v1";
  const prompt =
    `${GRAPH_BUILDER_PROMPT}\n\n---\n\nCANDIDATE A:\n${describeCandidate(input.candidateA)}\n\n` +
    `CANDIDATE B:\n${describeCandidate(input.candidateB)}\n\nJOB: ${input.jobId}`;
  const promptHash = computePromptHash(promptTemplateId, prompt);
  const inputSummary = `jobId=${input.jobId} a=${input.candidateA.candidateId} b=${input.candidateB.candidateId}`;

  let parsed: GraphBuilderOutput = FAILED_OUTPUT;
  let runStatus: "success" | "failed" | "retried" = "success";
  let errorMessage: string | undefined;
  let durationMs = 0;
  let retryCount = 0;

  try {
    const result = await completeWithSchemaRetry(
      client,
      promptTemplateId,
      prompt,
      (raw) => parseGraphBuilderOutput(raw),
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

  const agentRun = buildAgentRun({
    agentName: "graph_builder",
    entityType: "candidate",
    entityRef: input.candidateA.candidateId,
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
  try { commands.push(appendAgentRun(agentRun)); } catch { /* audit */ }

  return { commands, agentRun };
}
