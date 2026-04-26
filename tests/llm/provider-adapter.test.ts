import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildProviderAdapterReadiness,
  mapProviderAdapterError,
  type ProviderAdapterConfig,
} from "../../src/llm/provider-adapter.js";

describe("buildProviderAdapterReadiness - disabled", () => {
  it("returns disabled when enabled=false", () => {
    const readiness = buildProviderAdapterReadiness({
      enabled: false,
      providerName: "test",
    });
    assert.equal(readiness.status, "disabled");
    assert.equal(readiness.canCallExternalModel, false);
  });

  it("has blocked reason for disabled", () => {
    const readiness = buildProviderAdapterReadiness({
      enabled: false,
      providerName: "test",
    });
    assert.ok(readiness.blockedReasons.length > 0);
    assert.ok(readiness.blockedReasons[0]!.includes("not enabled"));
  });
});

describe("buildProviderAdapterReadiness - blocked (missing config)", () => {
  it("returns blocked when enabled but missing endpoint", () => {
    const readiness = buildProviderAdapterReadiness({
      enabled: true,
      providerName: "test",
      endpoint: null,
      modelId: "ep-test",
      apiKey: "sk-test",
    });
    assert.equal(readiness.status, "blocked");
    assert.equal(readiness.canCallExternalModel, false);
  });

  it("returns blocked when enabled but missing apiKey", () => {
    const readiness = buildProviderAdapterReadiness({
      enabled: true,
      providerName: "test",
      endpoint: "https://example.com",
      modelId: "ep-test",
      apiKey: null,
    });
    assert.equal(readiness.status, "blocked");
    assert.equal(readiness.canCallExternalModel, false);
  });

  it("returns blocked when enabled but missing modelId", () => {
    const readiness = buildProviderAdapterReadiness({
      enabled: true,
      providerName: "test",
      endpoint: "https://example.com",
      modelId: null,
      apiKey: "sk-test",
    });
    assert.equal(readiness.status, "blocked");
    assert.equal(readiness.canCallExternalModel, false);
  });

  it("returns blocked when enabled with all required config missing", () => {
    const readiness = buildProviderAdapterReadiness({
      enabled: true,
      providerName: "test",
      endpoint: null,
      modelId: null,
      apiKey: null,
    });
    assert.equal(readiness.status, "blocked");
    assert.equal(readiness.blockedReasons.length, 3);
  });
});

describe("buildProviderAdapterReadiness - ready", () => {
  it("returns ready when enabled with complete config", () => {
    const readiness = buildProviderAdapterReadiness({
      enabled: true,
      providerName: "test",
      endpoint: "https://example.com/v1/chat",
      modelId: "ep-test",
      apiKey: "sk-test",
    });
    assert.equal(readiness.status, "ready");
    assert.equal(readiness.canCallExternalModel, true);
    assert.equal(readiness.blockedReasons.length, 0);
  });
});

describe("buildProviderAdapterReadiness - output safety", () => {
  const sensitivePatterns = ["sk-test", "https://example.com", "ep-test"];

  it("safeSummary does not contain endpoint or apiKey", () => {
    const configs: ProviderAdapterConfig[] = [
      { enabled: false, providerName: "test" },
      { enabled: true, providerName: "test", endpoint: null, apiKey: null },
      {
        enabled: true,
        providerName: "test",
        endpoint: "https://example.com",
        modelId: "ep-test",
        apiKey: "sk-test",
      },
    ];

    for (const config of configs) {
      const readiness = buildProviderAdapterReadiness(config);
      for (const pattern of sensitivePatterns) {
        assert.ok(
          !readiness.safeSummary.includes(pattern),
          `safeSummary must not contain ${pattern}`,
        );
      }
    }
  });

  it("blockedReasons do not contain endpoint, modelId, or apiKey values", () => {
    const readiness = buildProviderAdapterReadiness({
      enabled: true,
      providerName: "test",
      endpoint: "https://secret-endpoint.example.com",
      modelId: "ep-secret-model",
      apiKey: "sk-super-secret-key",
    });
    assert.equal(readiness.status, "ready");
    assert.equal(readiness.blockedReasons.length, 0);

    const blocked = buildProviderAdapterReadiness({
      enabled: true,
      providerName: "test",
      endpoint: null,
      modelId: null,
      apiKey: "sk-super-secret-key",
    });
    for (const reason of blocked.blockedReasons) {
      assert.ok(!reason.includes("sk-super-secret-key"), "Reason must not contain apiKey");
      assert.ok(!reason.includes("secret-endpoint"), "Reason must not contain endpoint");
      assert.ok(!reason.includes("ep-secret-model"), "Reason must not contain modelId");
    }
  });
});

describe("mapProviderAdapterError", () => {
  it("maps timeout error", () => {
    const err = mapProviderAdapterError(new Error("Request timeout after 30s"));
    assert.equal(err.kind, "timeout");
    assert.equal(err.retryable, true);
  });

  it("maps abort error as timeout", () => {
    const err = mapProviderAdapterError(new DOMException("The operation was aborted", "AbortError"));
    assert.equal(err.kind, "timeout");
    assert.equal(err.retryable, true);
  });

  it("maps rate limit / 429 error", () => {
    const err = mapProviderAdapterError(new Error("HTTP 429 rate limit exceeded"));
    assert.equal(err.kind, "rate_limited");
    assert.equal(err.retryable, true);
  });

  it("maps disabled error", () => {
    const err = mapProviderAdapterError(new Error("Provider is disabled"));
    assert.equal(err.kind, "disabled");
    assert.equal(err.retryable, false);
  });

  it("maps missing config error", () => {
    const err = mapProviderAdapterError(new Error("Missing config: endpoint"));
    assert.equal(err.kind, "missing_config");
    assert.equal(err.retryable, false);
  });

  it("maps invalid response error", () => {
    const err = mapProviderAdapterError(new Error("Invalid JSON in response"));
    assert.equal(err.kind, "invalid_response");
    assert.equal(err.retryable, false);
  });

  it("maps schema validation error", () => {
    const err = mapProviderAdapterError(new Error("Schema validation failed for response"));
    assert.equal(err.kind, "invalid_response");
    assert.equal(err.retryable, false);
  });

  it("maps unknown error as provider_error", () => {
    const err = mapProviderAdapterError(new Error("Something unexpected happened"));
    assert.equal(err.kind, "provider_error");
    assert.equal(err.retryable, true);
  });

  it("maps non-Error as provider_error", () => {
    const err = mapProviderAdapterError("string error");
    assert.equal(err.kind, "provider_error");
    assert.equal(err.retryable, true);
  });
});

describe("mapProviderAdapterError - safeMessage security", () => {
  it("safeMessage does not contain token/stdout/payload/raw stderr", () => {
    const errors = [
      new Error("timeout"),
      new Error("429 rate limit"),
      new Error("disabled"),
      new Error("missing config"),
      new Error("invalid JSON"),
      new Error("unknown error with token=sk-abc stdout=payload data"),
    ];

    const forbidden = [/token/i, /stdout/i, /payload/i, /raw stderr/i, /sk-abc/];
    for (const error of errors) {
      const mapped = mapProviderAdapterError(error);
      for (const pattern of forbidden) {
        assert.doesNotMatch(
          mapped.safeMessage,
          pattern,
          `safeMessage for "${error.message}" must not match ${pattern}`,
        );
      }
    }
  });
});
