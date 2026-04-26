import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DisabledProviderClient } from "../../src/llm/disabled-provider-client.js";

describe("DisabledProviderClient - constructor", () => {
  it("exposes readiness from config", () => {
    const client = new DisabledProviderClient({
      enabled: false,
      providerName: "test",
    });
    assert.equal(client.readiness.status, "disabled");
    assert.equal(client.readiness.canCallExternalModel, false);
  });

  it("exposes ready readiness when config is complete", () => {
    const client = new DisabledProviderClient({
      enabled: true,
      providerName: "test",
      endpoint: "https://example.com",
      modelId: "ep-test",
      apiKey: "sk-test",
    });
    assert.equal(client.readiness.status, "ready");
    assert.equal(client.readiness.canCallExternalModel, true);
  });
});

describe("DisabledProviderClient - complete rejects fail-closed", () => {
  it("disabled client rejects complete", async () => {
    const client = new DisabledProviderClient({
      enabled: false,
      providerName: "test",
    });

    await assert.rejects(
      () => client.complete({ promptTemplateId: "test", prompt: "hello" }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes("not ready"));
        return true;
      },
    );
  });

  it("blocked client rejects complete", async () => {
    const client = new DisabledProviderClient({
      enabled: true,
      providerName: "test",
      endpoint: null,
      modelId: null,
      apiKey: null,
    });

    await assert.rejects(
      () => client.complete({ promptTemplateId: "test", prompt: "hello" }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes("not ready"));
        return true;
      },
    );
  });
});

describe("DisabledProviderClient - ready config still rejects", () => {
  it("rejects even when config is ready (real API not implemented)", async () => {
    const client = new DisabledProviderClient({
      enabled: true,
      providerName: "test",
      endpoint: "https://example.com",
      modelId: "ep-test",
      apiKey: "sk-test",
    });

    await assert.rejects(
      () => client.complete({ promptTemplateId: "test", prompt: "hello" }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes("not implemented") ||
          err.message.includes("boundary only"),
        );
        return true;
      },
    );
  });
});

describe("DisabledProviderClient - error message safety", () => {
  it("does not leak prompt in error message", async () => {
    const client = new DisabledProviderClient({
      enabled: false,
      providerName: "test",
    });

    const secretPrompt = "secret-super-confidential-prompt-text";
    await assert.rejects(
      () => client.complete({ promptTemplateId: "test", prompt: secretPrompt }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(!err.message.includes(secretPrompt));
        return true;
      },
    );
  });

  it("does not leak apiKey or endpoint in error message", async () => {
    const client = new DisabledProviderClient({
      enabled: true,
      providerName: "test",
      endpoint: "https://secret-endpoint.example.com",
      modelId: "ep-secret-model",
      apiKey: "sk-super-secret-key-12345",
    });

    await assert.rejects(
      () => client.complete({ promptTemplateId: "test", prompt: "hello" }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(!err.message.includes("sk-super-secret-key-12345"));
        assert.ok(!err.message.includes("secret-endpoint"));
        assert.ok(!err.message.includes("ep-secret-model"));
        return true;
      },
    );
  });
});

describe("DisabledProviderClient - no network dependency", () => {
  it("does not have fetch or http properties", () => {
    const client = new DisabledProviderClient({
      enabled: false,
      providerName: "test",
    });
    const proto = Object.getPrototypeOf(client);
    const ownKeys = Object.getOwnPropertyNames(proto);
    assert.ok(!ownKeys.includes("fetch"), "Must not have fetch method");
    assert.ok(!ownKeys.includes("http"), "Must not have http property");
  });
});
