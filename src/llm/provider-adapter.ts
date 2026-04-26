export type ProviderAdapterStatus = "disabled" | "ready" | "blocked";

export interface ProviderAdapterConfig {
  enabled: boolean;
  providerName: string;
  endpoint?: string | null;
  modelId?: string | null;
  apiKey?: string | null;
  timeoutMs?: number | null;
}

export interface ProviderAdapterReadiness {
  status: ProviderAdapterStatus;
  providerName: string;
  canCallExternalModel: boolean;
  blockedReasons: string[];
  safeSummary: string;
}

export type ProviderAdapterErrorKind =
  | "disabled"
  | "missing_config"
  | "timeout"
  | "rate_limited"
  | "provider_error"
  | "invalid_response";

export interface ProviderAdapterError {
  kind: ProviderAdapterErrorKind;
  retryable: boolean;
  safeMessage: string;
}

export function buildProviderAdapterReadiness(
  config: ProviderAdapterConfig,
): ProviderAdapterReadiness {
  if (!config.enabled) {
    return {
      status: "disabled",
      providerName: config.providerName,
      canCallExternalModel: false,
      blockedReasons: ["Provider adapter is not enabled."],
      safeSummary: `Provider "${config.providerName}" is disabled. No external model calls will be made.`,
    };
  }

  const missing: string[] = [];
  if (!config.endpoint) {
    missing.push("endpoint");
  }
  if (!config.modelId) {
    missing.push("model ID");
  }
  if (!config.apiKey) {
    missing.push("API key");
  }

  if (missing.length > 0) {
    return {
      status: "blocked",
      providerName: config.providerName,
      canCallExternalModel: false,
      blockedReasons: missing.map((m) => `Missing required config: ${m}.`),
      safeSummary: `Provider "${config.providerName}" is enabled but configuration is incomplete.`,
    };
  }

  return {
    status: "ready",
    providerName: config.providerName,
    canCallExternalModel: true,
    blockedReasons: [],
    safeSummary: `Provider "${config.providerName}" is ready. External model calls are configured.`,
  };
}

export function mapProviderAdapterError(error: unknown): ProviderAdapterError {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();

    if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("etimedout")) {
      return {
        kind: "timeout",
        retryable: true,
        safeMessage: "Provider request timed out.",
      };
    }

    if (msg.includes("429") || msg.includes("rate limit") || msg.includes("rate_limit")) {
      return {
        kind: "rate_limited",
        retryable: true,
        safeMessage: "Provider rate limit reached.",
      };
    }

    if (msg.includes("disabled")) {
      return {
        kind: "disabled",
        retryable: false,
        safeMessage: "Provider adapter is disabled.",
      };
    }

    if (msg.includes("missing config") || msg.includes("missing_config") || msg.includes("incomplete")) {
      return {
        kind: "missing_config",
        retryable: false,
        safeMessage: "Provider configuration is incomplete.",
      };
    }

    if (msg.includes("invalid") || msg.includes("json") || msg.includes("schema") || msg.includes("parse")) {
      return {
        kind: "invalid_response",
        retryable: false,
        safeMessage: "Provider returned an invalid response.",
      };
    }
  }

  return {
    kind: "provider_error",
    retryable: true,
    safeMessage: "Provider returned an unexpected error.",
  };
}
