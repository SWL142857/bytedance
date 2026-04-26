import {
  buildProviderAdapterReadiness,
  mapProviderAdapterError,
  type ProviderAdapterConfig,
} from "./provider-adapter.js";

export type ProviderSmokeMode = "dry_run" | "execute";
export type ProviderSmokeStatus =
  | "planned"
  | "blocked"
  | "success"
  | "failed";

export interface ProviderSmokeResult {
  mode: ProviderSmokeMode;
  status: ProviderSmokeStatus;
  providerName: string;
  canCallExternalModel: boolean;
  httpStatus: number | null;
  hasChoices: boolean | null;
  contentLength: number | null;
  durationMs: number;
  blockedReasons: string[];
  errorKind: string | null;
  safeSummary: string;
}

export interface ProviderSmokeOptions {
  execute: boolean;
  confirm?: string;
  timeoutMs?: number;
}

const REQUIRED_CONFIRM = "EXECUTE_PROVIDER_SMOKE";
const SMOKE_PROMPT = "ping";
const SMOKE_MAX_TOKENS = 8;

export function buildProviderSmokePlan(
  config: ProviderAdapterConfig,
  options: ProviderSmokeOptions,
): ProviderSmokeResult {
  const readiness = buildProviderAdapterReadiness(config);

  if (!options.execute) {
    return {
      mode: "dry_run",
      status: "planned",
      providerName: config.providerName,
      canCallExternalModel: readiness.canCallExternalModel,
      httpStatus: null,
      hasChoices: null,
      contentLength: null,
      durationMs: 0,
      blockedReasons: [],
      errorKind: null,
      safeSummary: `Dry-run only. Provider "${config.providerName}" connectivity test is planned but not executed.`,
    };
  }

  const blocked = buildExecuteBlockedReasons(config, readiness, options);
  if (blocked.length > 0) {
    return {
      mode: "execute",
      status: "blocked",
      providerName: config.providerName,
      canCallExternalModel: readiness.canCallExternalModel,
      httpStatus: null,
      hasChoices: null,
      contentLength: null,
      durationMs: 0,
      blockedReasons: blocked,
      errorKind: null,
      safeSummary: `Provider connectivity smoke is blocked. Fix ${blocked.length} issue(s) before retrying.`,
    };
  }

  return {
    mode: "execute",
    status: "planned",
    providerName: config.providerName,
    canCallExternalModel: readiness.canCallExternalModel,
    httpStatus: null,
    hasChoices: null,
    contentLength: null,
    durationMs: 0,
    blockedReasons: [],
    errorKind: null,
    safeSummary: `Provider "${config.providerName}" connectivity smoke is ready to execute.`,
  };
}

export async function runProviderConnectivitySmoke(
  config: ProviderAdapterConfig,
  options: ProviderSmokeOptions,
): Promise<ProviderSmokeResult> {
  const plan = buildProviderSmokePlan(config, options);

  if (plan.status !== "planned" || plan.mode === "dry_run") {
    return plan;
  }

  const timeoutMs = options.timeoutMs ?? 15000;
  const start = Date.now();

  try {
    const response = await executeSmokeRequest(config, timeoutMs);
    const durationMs = Date.now() - start;

    if (!response.ok) {
      return {
        mode: "execute",
        status: "failed",
        providerName: config.providerName,
        canCallExternalModel: true,
        httpStatus: response.status,
        hasChoices: null,
        contentLength: null,
        durationMs,
        blockedReasons: [],
        errorKind: "provider_error",
        safeSummary: `Provider returned HTTP ${response.status}. Connectivity test failed.`,
      };
    }

    const body = await response.json();
    const choices = Array.isArray((body as Record<string, unknown>).choices);
    const content = extractContentLength(body);

    return {
      mode: "execute",
      status: "success",
      providerName: config.providerName,
      canCallExternalModel: true,
      httpStatus: response.status,
      hasChoices: choices,
      contentLength: content,
      durationMs,
      blockedReasons: [],
      errorKind: null,
      safeSummary: `Provider connectivity test succeeded. HTTP ${response.status}.`,
    };
  } catch (err: unknown) {
    const durationMs = Date.now() - start;
    const mapped = mapProviderAdapterError(err);

    return {
      mode: "execute",
      status: "failed",
      providerName: config.providerName,
      canCallExternalModel: true,
      httpStatus: null,
      hasChoices: null,
      contentLength: null,
      durationMs,
      blockedReasons: [],
      errorKind: mapped.kind,
      safeSummary: mapped.safeMessage,
    };
  }
}

function buildExecuteBlockedReasons(
  config: ProviderAdapterConfig,
  readiness: ReturnType<typeof buildProviderAdapterReadiness>,
  options: ProviderSmokeOptions,
): string[] {
  const reasons: string[] = [];

  if (!readiness.canCallExternalModel) {
    reasons.push("Provider adapter is not ready.");
  }

  if (options.confirm !== REQUIRED_CONFIRM) {
    reasons.push("Confirmation phrase is required.");
  }

  if (!config.endpoint) {
    reasons.push("Missing required config: endpoint.");
  }

  if (!config.modelId) {
    reasons.push("Missing required config: model ID.");
  }

  if (!config.apiKey) {
    reasons.push("Missing required config: API key.");
  }

  return reasons;
}

async function executeSmokeRequest(
  config: ProviderAdapterConfig,
  timeoutMs: number,
): Promise<Response> {
  if (!config.endpoint || !config.modelId || !config.apiKey) {
    throw new Error("Missing config for provider smoke request.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `${config.endpoint.replace(/\/+$/, "")}/chat/completions`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.modelId,
        messages: [{ role: "user", content: SMOKE_PROMPT }],
        max_tokens: SMOKE_MAX_TOKENS,
        temperature: 0,
      }),
      signal: controller.signal,
    });

    return response;
  } finally {
    clearTimeout(timer);
  }
}

function extractContentLength(body: unknown): number | null {
  if (!body || typeof body !== "object") return null;

  const choices = (body as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;

  const first = choices[0] as Record<string, unknown> | undefined;
  if (!first) return null;

  const message = first.message as Record<string, unknown> | undefined;
  if (!message || typeof message.content !== "string") return null;

  return message.content.length;
}
