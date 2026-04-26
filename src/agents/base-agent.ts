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
  runStatus: "success" | "failed" | "retried";
  errorMessage?: string;
  retryCount?: number;
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
    retry_count: params.retryCount ?? 0,
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

export type SchemaRetryErrorKind = "json_parse" | "schema_validation";

export interface SchemaRetryResult<T> {
  parsed: T;
  retryCount: number;
  durationMs: number;
}

const RETRY_CORRECTION_PREFIX = "Your previous output was not valid. Please return only valid JSON conforming to the expected schema.";

function classifyError(err: unknown): SchemaRetryErrorKind {
  if (err instanceof SyntaxError) return "json_parse";
  const msg = err instanceof Error ? err.message.toLowerCase() : "";
  if (msg.includes("unexpected token") || msg.includes("unexpected end") || msg.includes("is not valid json")) return "json_parse";
  return "schema_validation";
}

export function buildSafeRetryPrompt(errorKind: SchemaRetryErrorKind): string {
  const detail = errorKind === "json_parse"
    ? "The output was not valid JSON."
    : "The output did not match the required schema.";
  return `${RETRY_CORRECTION_PREFIX} ${detail} Do not include any explanation, only the JSON object.`;
}

export async function completeWithSchemaRetry<T>(
  client: LlmClient,
  promptTemplateId: string,
  originalPrompt: string,
  parse: (value: unknown) => T,
): Promise<SchemaRetryResult<T>> {
  const start = Date.now();

  // First attempt
  const { response } = await callLlm(client, { promptTemplateId, prompt: originalPrompt });

  try {
    const raw = JSON.parse(response.content);
    const parsed = parse(raw);
    return { parsed, retryCount: 0, durationMs: Date.now() - start };
  } catch (firstErr) {
    const errorKind = classifyError(firstErr);

    // Retry once with safe correction prompt
    const retryPrompt = buildSafeRetryPrompt(errorKind);
    const retryResponse = await callLlm(client, { promptTemplateId, prompt: retryPrompt });

    try {
      const raw = JSON.parse(retryResponse.response.content);
      const parsed = parse(raw);
      return { parsed, retryCount: 1, durationMs: Date.now() - start };
    } catch {
      throw new SchemaRetryFailedError(errorKind);
    }
  }
}

export class SchemaRetryFailedError extends Error {
  readonly errorKind: SchemaRetryErrorKind;

  constructor(errorKind: SchemaRetryErrorKind) {
    const detail = errorKind === "json_parse"
      ? "Output was not valid JSON after retry."
      : "Output did not match schema after retry.";
    super(`Schema validation failed: ${detail}`);
    this.name = "SchemaRetryFailedError";
    this.errorKind = errorKind;
  }
}
