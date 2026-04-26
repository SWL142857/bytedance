import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildProviderSmokePlan,
  runProviderConnectivitySmoke,
  type ProviderSmokeOptions,
} from "../../src/llm/provider-smoke-runner.js";
import type { ProviderAdapterConfig } from "../../src/llm/provider-adapter.js";

const FULL_CONFIG: ProviderAdapterConfig = {
  enabled: true,
  providerName: "test-provider",
  endpoint: "https://example.com/v1",
  modelId: "ep-test-model",
  apiKey: "sk-test-key",
};

const DRY_RUN_OPTIONS: ProviderSmokeOptions = { execute: false };
const EXECUTE_OPTIONS: ProviderSmokeOptions = {
  execute: true,
  confirm: "EXECUTE_PROVIDER_SMOKE",
};

describe("buildProviderSmokePlan - dry-run", () => {
  it("returns planned without calling fetch", () => {
    const result = buildProviderSmokePlan(FULL_CONFIG, DRY_RUN_OPTIONS);
    assert.equal(result.mode, "dry_run");
    assert.equal(result.status, "planned");
    assert.equal(result.httpStatus, null);
    assert.equal(result.durationMs, 0);
  });

  it("safeSummary does not contain endpoint/apiKey/modelId", () => {
    const result = buildProviderSmokePlan(FULL_CONFIG, DRY_RUN_OPTIONS);
    assert.ok(!result.safeSummary.includes("https://example.com"));
    assert.ok(!result.safeSummary.includes("sk-test-key"));
    assert.ok(!result.safeSummary.includes("ep-test-model"));
  });
});

describe("buildProviderSmokePlan - execute blocked", () => {
  it("blocks without confirm", () => {
    const result = buildProviderSmokePlan(FULL_CONFIG, {
      execute: true,
      confirm: undefined,
    });
    assert.equal(result.status, "blocked");
    assert.ok(result.blockedReasons.some((r) => r.includes("Confirmation")));
  });

  it("blocks with wrong confirm", () => {
    const result = buildProviderSmokePlan(FULL_CONFIG, {
      execute: true,
      confirm: "WRONG_PHRASE",
    });
    assert.equal(result.status, "blocked");
  });

  it("blocks when missing endpoint", () => {
    const config: ProviderAdapterConfig = {
      enabled: true,
      providerName: "test",
      endpoint: null,
      modelId: "ep-test",
      apiKey: "sk-test",
    };
    const result = buildProviderSmokePlan(config, EXECUTE_OPTIONS);
    assert.equal(result.status, "blocked");
    assert.ok(result.blockedReasons.some((r) => r.includes("endpoint")));
  });

  it("blocks when missing modelId", () => {
    const config: ProviderAdapterConfig = {
      enabled: true,
      providerName: "test",
      endpoint: "https://example.com",
      modelId: null,
      apiKey: "sk-test",
    };
    const result = buildProviderSmokePlan(config, EXECUTE_OPTIONS);
    assert.equal(result.status, "blocked");
    assert.ok(result.blockedReasons.some((r) => r.includes("model ID")));
  });

  it("blocks when missing apiKey", () => {
    const config: ProviderAdapterConfig = {
      enabled: true,
      providerName: "test",
      endpoint: "https://example.com",
      modelId: "ep-test",
      apiKey: null,
    };
    const result = buildProviderSmokePlan(config, EXECUTE_OPTIONS);
    assert.equal(result.status, "blocked");
    assert.ok(result.blockedReasons.some((r) => r.includes("API key")));
  });

  it("blocked safeSummary does not leak secrets", () => {
    const result = buildProviderSmokePlan(FULL_CONFIG, {
      execute: true,
      confirm: undefined,
    });
    assert.ok(!result.safeSummary.includes("sk-test-key"));
    assert.ok(!result.safeSummary.includes("https://example.com"));
    assert.ok(!result.safeSummary.includes("ep-test-model"));
  });
});

describe("runProviderConnectivitySmoke - dry-run", () => {
  it("returns planned without calling fetch", async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      throw new Error("fetch must not be called");
    };

    try {
      const result = await runProviderConnectivitySmoke(FULL_CONFIG, DRY_RUN_OPTIONS);
      assert.equal(result.mode, "dry_run");
      assert.equal(result.status, "planned");
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("execute blocked without confirm does not call fetch", async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      throw new Error("fetch must not be called");
    };

    try {
      const result = await runProviderConnectivitySmoke(FULL_CONFIG, {
        execute: true,
        confirm: undefined,
      });
      assert.equal(result.status, "blocked");
      assert.equal(result.httpStatus, null);
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("runProviderConnectivitySmoke - execute success", () => {
  it("returns success with mocked fetch", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          choices: [
            { message: { role: "assistant", content: "pong" } },
          ],
        }),
        { status: 200 },
      );
    };

    try {
      const result = await runProviderConnectivitySmoke(FULL_CONFIG, EXECUTE_OPTIONS);
      assert.equal(result.mode, "execute");
      assert.equal(result.status, "success");
      assert.equal(result.httpStatus, 200);
      assert.equal(result.hasChoices, true);
      assert.equal(result.contentLength, 4);
      assert.ok(result.durationMs >= 0);
      assert.equal(result.errorKind, null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("runProviderConnectivitySmoke - execute HTTP error", () => {
  it("returns failed for non-200 response", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      return new Response("error", { status: 500 });
    };

    try {
      const result = await runProviderConnectivitySmoke(FULL_CONFIG, EXECUTE_OPTIONS);
      assert.equal(result.status, "failed");
      assert.equal(result.httpStatus, 500);
      assert.equal(result.errorKind, "provider_error");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns failed for 401 unauthorized", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      return new Response("unauthorized", { status: 401 });
    };

    try {
      const result = await runProviderConnectivitySmoke(FULL_CONFIG, EXECUTE_OPTIONS);
      assert.equal(result.status, "failed");
      assert.equal(result.httpStatus, 401);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("runProviderConnectivitySmoke - timeout", () => {
  it("maps abort to timeout error", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new DOMException("The operation was aborted", "AbortError");
    };

    try {
      const result = await runProviderConnectivitySmoke(
        FULL_CONFIG,
        { ...EXECUTE_OPTIONS, timeoutMs: 1 },
      );
      assert.equal(result.status, "failed");
      assert.equal(result.errorKind, "timeout");
      assert.equal(result.httpStatus, null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("runProviderConnectivitySmoke - output safety", () => {
  const forbidden = [
    "sk-test-key",
    "https://example.com",
    "ep-test-model",
    "payload",
    "authorization",
    "Bearer",
    "raw response",
    "prompt",
  ];

  it("success result does not contain secrets", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "pong" } }],
        }),
        { status: 200 },
      );
    };

    try {
      const result = await runProviderConnectivitySmoke(FULL_CONFIG, EXECUTE_OPTIONS);
      for (const pattern of forbidden) {
        assert.ok(
          !result.safeSummary.includes(pattern),
          `safeSummary must not contain ${pattern}`,
        );
        assert.ok(
          !result.blockedReasons.some((r) => r.includes(pattern)),
          `blockedReasons must not contain ${pattern}`,
        );
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("failed result does not contain secrets", async () => {
    const result = buildProviderSmokePlan(FULL_CONFIG, {
      execute: true,
      confirm: undefined,
    });
    for (const pattern of forbidden) {
      assert.ok(
        !result.safeSummary.includes(pattern),
        `safeSummary must not contain ${pattern}`,
      );
    }
  });
});
