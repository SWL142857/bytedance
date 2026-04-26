import type { LlmClient, LlmRequest, LlmResponse } from "./client.js";
import {
  buildProviderAdapterReadiness,
  type ProviderAdapterConfig,
  type ProviderAdapterReadiness,
} from "./provider-adapter.js";

export class DisabledProviderClient implements LlmClient {
  readonly readiness: ProviderAdapterReadiness;

  constructor(config: ProviderAdapterConfig) {
    this.readiness = buildProviderAdapterReadiness(config);
  }

  async complete(_request: LlmRequest): Promise<LlmResponse> {
    if (this.readiness.status !== "ready") {
      throw new Error(
        `Provider adapter is not ready (status: ${this.readiness.status}). ` +
        `Cannot complete request. ${this.readiness.blockedReasons.length} blocked reason(s).`,
      );
    }

    throw new Error(
      "Provider adapter boundary only. Real API integration is not implemented. " +
      "Use deterministic client for local development.",
    );
  }
}
