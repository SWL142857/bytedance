import type { LlmClient, LlmRequest, LlmResponse } from "./client.js";
import {
  buildProviderAdapterReadiness,
  mapProviderAdapterError,
  type ProviderAdapterConfig,
  type ProviderAdapterReadiness,
} from "./provider-adapter.js";

export interface OpenAICompatibleClientOptions {
  config: ProviderAdapterConfig;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_TOKENS = 800;

class SafeProviderClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafeProviderClientError";
  }
}

function buildRequestUrl(endpoint: string): string {
  return `${endpoint.replace(/\/+$/, "")}/chat/completions`;
}

function buildHttpError(status: number): SafeProviderClientError {
  const mapped = mapProviderAdapterError(new Error(`HTTP ${status}`));
  const message = mapped.kind === "rate_limited"
    ? mapped.safeMessage
    : `Provider returned HTTP ${status}.`;
  return new SafeProviderClientError(message);
}

function buildInvalidResponseError(): SafeProviderClientError {
  const mapped = mapProviderAdapterError(new Error("Invalid provider response"));
  return new SafeProviderClientError(mapped.safeMessage);
}

export class OpenAICompatibleClient implements LlmClient {
  readonly readiness: ProviderAdapterReadiness;
  private readonly config: ProviderAdapterConfig;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: OpenAICompatibleClientOptions) {
    this.config = options.config;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchFn = options.fetchFn ?? fetch;
    this.readiness = buildProviderAdapterReadiness(options.config);
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    if (this.readiness.status !== "ready") {
      throw new SafeProviderClientError(
        `Provider adapter is not ready (status: ${this.readiness.status}). ` +
        `Cannot complete request. ${this.readiness.blockedReasons.length} blocked reason(s).`,
      );
    }

    const endpoint = this.config.endpoint;
    const modelId = this.config.modelId;
    const apiKey = this.config.apiKey;

    if (!endpoint || !modelId || !apiKey) {
      throw new SafeProviderClientError("Provider configuration is incomplete.");
    }

    const url = buildRequestUrl(endpoint);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchFn(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: "user", content: request.prompt }],
          max_tokens: DEFAULT_MAX_TOKENS,
          temperature: 0,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw buildHttpError(response.status);
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw buildInvalidResponseError();
      }

      const content = extractContent(body);
      if (content === null) {
        throw buildInvalidResponseError();
      }

      return {
        content,
        promptTemplateId: request.promptTemplateId,
      };
    } catch (err: unknown) {
      if (err instanceof SafeProviderClientError) {
        throw err;
      }
      const mapped = mapProviderAdapterError(err);
      throw new Error(mapped.safeMessage);
    } finally {
      clearTimeout(timer);
    }
  }
}

function extractContent(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;

  const choices = (body as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;

  const first = choices[0] as Record<string, unknown> | undefined;
  if (!first) return null;

  const message = first.message as Record<string, unknown> | undefined;
  if (!message || typeof message.content !== "string") return null;

  return message.content;
}
