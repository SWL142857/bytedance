import { createHash } from "node:crypto";
import type { LlmClient, LlmRequest, LlmResponse } from "../llm/client.js";
import type { AgentRunRecord } from "../base/runtime.js";
import type { BaseCommandSpec } from "../base/commands.js";

export interface AgentContext {
  candidateRecordId: string;
  candidateId: string;
  fromStatus: string;
}

export interface AgentResult {
  commands: BaseCommandSpec[];
  agentRun: AgentRunRecord;
}

export function computePromptHash(promptTemplateId: string, prompt: string): string {
  return createHash("sha256").update(promptTemplateId).update(prompt).digest("hex").slice(0, 16);
}

export function getGitCommitHash(): string {
  return process.env.HIRELOOP_GIT_COMMIT ?? "unknown";
}

export function buildAgentRun(params: {
  agentName: string;
  entityType: string;
  entityRef: string;
  inputSummary: string;
  outputJson: string;
  promptTemplateId: string;
  promptHash: string;
  statusBefore?: string;
  statusAfter?: string;
  runStatus: "success" | "failed";
  errorMessage?: string;
  durationMs: number;
}): AgentRunRecord {
  return {
    run_id: `run_${params.agentName}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    agent_name: params.agentName,
    entity_type: params.entityType,
    entity_ref: params.entityRef,
    input_summary: params.inputSummary,
    output_json: params.outputJson,
    prompt_template_id: params.promptTemplateId,
    git_commit_hash: getGitCommitHash(),
    prompt_hash: params.promptHash,
    status_before: params.statusBefore as AgentRunRecord["status_before"],
    status_after: params.statusAfter as AgentRunRecord["status_after"],
    run_status: params.runStatus,
    error_message: params.errorMessage,
    retry_count: 0,
    duration_ms: params.durationMs,
  };
}

export async function callLlm(
  client: LlmClient,
  request: LlmRequest,
): Promise<{ response: LlmResponse; durationMs: number }> {
  const start = Date.now();
  const response = await client.complete(request);
  return { response, durationMs: Date.now() - start };
}
