import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { OpenAICompatibleClient } from "../../src/llm/openai-compatible-client.js";

function makeReadyConfig(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    providerName: "test-provider",
    endpoint: "https://api.test.example.com/v1",
    modelId: "ep-test-model",
    apiKey: "sk-test-key-12345",
    ...overrides,
  };
}

function makeMockFetch(
  response: { status: number; body: unknown },
): typeof fetch & { calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(url), init: init ?? {} });
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => response.body,
    } as Response;
  };
  return Object.assign(fn, { calls });
}

function makeMockFetchError(error: Error): typeof fetch {
  return async () => { throw error; };
}

describe("OpenAICompatibleClient — readiness guard", () => {
  it("disabled config rejects complete without calling fetch", async () => {
    const fetchFn = makeMockFetch({ status: 200, body: {} });
    const client = new OpenAICompatibleClient({
      config: { enabled: false, providerName: "test" },
      fetchFn,
    });

    assert.equal(client.readiness.status, "disabled");

    await assert.rejects(
      () => client.complete({ promptTemplateId: "test", prompt: "hello" }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes("not ready"));
        return true;
      },
    );

    assert.equal(fetchFn.calls.length, 0);
  });

  it("missing endpoint rejects complete without calling fetch", async () => {
    const fetchFn = makeMockFetch({ status: 200, body: {} });
    const client = new OpenAICompatibleClient({
      config: makeReadyConfig({ endpoint: null }),
      fetchFn,
    });

    assert.equal(client.readiness.status, "blocked");

    await assert.rejects(
      () => client.complete({ promptTemplateId: "test", prompt: "hello" }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes("not ready"));
        return true;
      },
    );

    assert.equal(fetchFn.calls.length, 0);
  });

  it("missing modelId rejects complete without calling fetch", async () => {
    const fetchFn = makeMockFetch({ status: 200, body: {} });
    const client = new OpenAICompatibleClient({
      config: makeReadyConfig({ modelId: null }),
      fetchFn,
    });

    assert.equal(client.readiness.status, "blocked");

    await assert.rejects(
      () => client.complete({ promptTemplateId: "test", prompt: "hello" }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes("not ready"));
        return true;
      },
    );

    assert.equal(fetchFn.calls.length, 0);
  });

  it("missing apiKey rejects complete without calling fetch", async () => {
    const fetchFn = makeMockFetch({ status: 200, body: {} });
    const client = new OpenAICompatibleClient({
      config: makeReadyConfig({ apiKey: null }),
      fetchFn,
    });

    assert.equal(client.readiness.status, "blocked");

    await assert.rejects(
      () => client.complete({ promptTemplateId: "test", prompt: "hello" }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes("not ready"));
        return true;
      },
    );

    assert.equal(fetchFn.calls.length, 0);
  });
});

describe("OpenAICompatibleClient — happy path", () => {
  it("ready config calls fetch and returns LlmResponse.content", async () => {
    const fetchFn = makeMockFetch({
      status: 200,
      body: {
        choices: [{ message: { role: "assistant", content: "parsed result" } }],
      },
    });

    const client = new OpenAICompatibleClient({
      config: makeReadyConfig(),
      fetchFn,
    });

    assert.equal(client.readiness.status, "ready");

    const result = await client.complete({
      promptTemplateId: "resume_parser_v1",
      prompt: "test prompt text",
    });

    assert.equal(result.content, "parsed result");
    assert.equal(result.promptTemplateId, "resume_parser_v1");
    assert.equal(fetchFn.calls.length, 1);
  });

  it("sends correct model in request body", async () => {
    const fetchFn = makeMockFetch({
      status: 200,
      body: {
        choices: [{ message: { role: "assistant", content: "ok" } }],
      },
    });

    const client = new OpenAICompatibleClient({
      config: makeReadyConfig({ modelId: "ep-custom-model" }),
      fetchFn,
    });

    await client.complete({ promptTemplateId: "test", prompt: "hello" });

    const body = JSON.parse(fetchFn.calls[0]!.init.body as string) as Record<string, unknown>;
    assert.equal(body.model, "ep-custom-model");
    assert.equal(body.temperature, 0);
    assert.ok(body.max_tokens);
  });

  it("sends user prompt in messages array", async () => {
    const fetchFn = makeMockFetch({
      status: 200,
      body: {
        choices: [{ message: { role: "assistant", content: "ok" } }],
      },
    });

    const client = new OpenAICompatibleClient({
      config: makeReadyConfig(),
      fetchFn,
    });

    await client.complete({ promptTemplateId: "test", prompt: "hello" });

    const body = JSON.parse(fetchFn.calls[0]!.init.body as string) as Record<string, unknown>;
    const messages = body.messages as Array<{ role: string; content: string }>;
    assert.equal(messages.length, 1);
    assert.equal(messages[0]!.role, "user");
    assert.equal(messages[0]!.content, "hello");
  });
});

describe("OpenAICompatibleClient — endpoint handling", () => {
  it("strips trailing slash from endpoint", async () => {
    const fetchFn = makeMockFetch({
      status: 200,
      body: {
        choices: [{ message: { role: "assistant", content: "ok" } }],
      },
    });

    const client = new OpenAICompatibleClient({
      config: makeReadyConfig({ endpoint: "https://api.test.example.com/v1/" }),
      fetchFn,
    });

    await client.complete({ promptTemplateId: "test", prompt: "hello" });

    assert.ok(fetchFn.calls[0]!.url.includes("/v1/chat/completions"));
    assert.ok(!fetchFn.calls[0]!.url.includes("/v1//chat/completions"));
  });

  it("handles multiple trailing slashes", async () => {
    const fetchFn = makeMockFetch({
      status: 200,
      body: {
        choices: [{ message: { role: "assistant", content: "ok" } }],
      },
    });

    const client = new OpenAICompatibleClient({
      config: makeReadyConfig({ endpoint: "https://api.test.example.com/v1///" }),
      fetchFn,
    });

    await client.complete({ promptTemplateId: "test", prompt: "hello" });

    assert.ok(fetchFn.calls[0]!.url.includes("/v1/chat/completions"));
    assert.ok(!fetchFn.calls[0]!.url.includes("/v1///chat/completions"));
  });
});

describe("OpenAICompatibleClient — HTTP errors", () => {
  it("HTTP 401 returns safe error without apiKey/endpoint/modelId/raw body", async () => {
    const fetchFn = makeMockFetch({
      status: 401,
      body: { error: { message: "invalid api_key sk-test-key-12345" } },
    });

    const client = new OpenAICompatibleClient({
      config: makeReadyConfig(),
      fetchFn,
    });

    await assert.rejects(
      () => client.complete({ promptTemplateId: "test", prompt: "hello" }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        const msg = err.message;
        assert.ok(msg.includes("HTTP 401"));
        assert.ok(!msg.includes("sk-test-key-12345"), "must not leak apiKey");
        assert.ok(!msg.includes("api.test.example.com"), "must not leak endpoint");
        assert.ok(!msg.includes("ep-test-model"), "must not leak modelId");
        assert.ok(!msg.includes("invalid api_key"), "must not leak raw body");
        return true;
      },
    );
  });

  it("HTTP 500 returns safe error without raw body", async () => {
    const fetchFn = makeMockFetch({
      status: 500,
      body: { error: { message: "internal server error with secret-super-key" } },
    });

    const client = new OpenAICompatibleClient({
      config: makeReadyConfig(),
      fetchFn,
    });

    await assert.rejects(
      () => client.complete({ promptTemplateId: "test", prompt: "hello" }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        const msg = err.message;
        assert.ok(msg.includes("HTTP 500"));
        assert.ok(!msg.includes("secret-super-key"), "must not leak raw body");
        return true;
      },
    );
  });

  it("HTTP 429 maps to a safe rate limit error", async () => {
    const fetchFn = makeMockFetch({
      status: 429,
      body: { error: { message: "rate limited for sk-test-key-12345" } },
    });

    const client = new OpenAICompatibleClient({
      config: makeReadyConfig(),
      fetchFn,
    });

    await assert.rejects(
      () => client.complete({ promptTemplateId: "test", prompt: "hello" }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        const msg = err.message;
        assert.equal(msg, "Provider rate limit reached.");
        assert.ok(!msg.includes("sk-test-key-12345"), "must not leak apiKey");
        return true;
      },
    );
  });
});

describe("OpenAICompatibleClient — invalid response", () => {
  it("invalid JSON throws safe error", async () => {
    const fetchFn = async (): Promise<Response> => ({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError("Unexpected token"); },
    }) as unknown as Response;

    const client = new OpenAICompatibleClient({
      config: makeReadyConfig(),
      fetchFn,
    });

    await assert.rejects(
      () => client.complete({ promptTemplateId: "test", prompt: "hello" }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes("invalid"));
        return true;
      },
    );
  });

  it("missing choices throws safe error", async () => {
    const fetchFn = makeMockFetch({ status: 200, body: {} });

    const client = new OpenAICompatibleClient({
      config: makeReadyConfig(),
      fetchFn,
    });

    await assert.rejects(
      () => client.complete({ promptTemplateId: "test", prompt: "hello" }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes("invalid"));
        return true;
      },
    );
  });

  it("empty choices throws safe error", async () => {
    const fetchFn = makeMockFetch({ status: 200, body: { choices: [] } });

    const client = new OpenAICompatibleClient({
      config: makeReadyConfig(),
      fetchFn,
    });

    await assert.rejects(
      () => client.complete({ promptTemplateId: "test", prompt: "hello" }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes("invalid"));
        return true;
      },
    );
  });

  it("missing content throws safe error", async () => {
    const fetchFn = makeMockFetch({
      status: 200,
      body: { choices: [{ message: { role: "assistant" } }] },
    });

    const client = new OpenAICompatibleClient({
      config: makeReadyConfig(),
      fetchFn,
    });

    await assert.rejects(
      () => client.complete({ promptTemplateId: "test", prompt: "hello" }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes("invalid"));
        return true;
      },
    );
  });

  it("null body throws safe error", async () => {
    const fetchFn = makeMockFetch({ status: 200, body: null });

    const client = new OpenAICompatibleClient({
      config: makeReadyConfig(),
      fetchFn,
    });

    await assert.rejects(
      () => client.complete({ promptTemplateId: "test", prompt: "hello" }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes("invalid"));
        return true;
      },
    );
  });
});

describe("OpenAICompatibleClient — timeout", () => {
  it("AbortError throws safe timeout error", async () => {
    const abortErr = new DOMException("The operation was aborted", "AbortError");
    const fetchFn = makeMockFetchError(abortErr);

    const client = new OpenAICompatibleClient({
      config: makeReadyConfig(),
      fetchFn,
      timeoutMs: 1,
    });

    await assert.rejects(
      () => client.complete({ promptTemplateId: "test", prompt: "hello" }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes("timed out") ||
          err.message.includes("timeout"),
        );
        return true;
      },
    );
  });
});

describe("OpenAICompatibleClient — network error safety", () => {
  it("thrown error with secret text does not leak in error message", async () => {
    const fetchFn = makeMockFetchError(
      new Error("Connection refused to sk-test-key-12345 at ep-test-model"),
    );

    const client = new OpenAICompatibleClient({
      config: makeReadyConfig(),
      fetchFn,
    });

    await assert.rejects(
      () => client.complete({ promptTemplateId: "test", prompt: "hello" }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        const msg = err.message;
        assert.ok(!msg.includes("sk-test-key-12345"), "must not leak apiKey");
        assert.ok(!msg.includes("ep-test-model"), "must not leak modelId");
        return true;
      },
    );
  });

  it("prompt text does not leak in error message for non-HTTP errors", async () => {
    const secretPrompt = "super-confidential-resume-content-secret";
    const fetchFn = makeMockFetchError(new Error("ECONNREFUSED"));

    const client = new OpenAICompatibleClient({
      config: makeReadyConfig(),
      fetchFn,
    });

    await assert.rejects(
      () => client.complete({ promptTemplateId: "test", prompt: secretPrompt }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(!err.message.includes(secretPrompt), "must not leak prompt");
        return true;
      },
    );
  });

  it("external error with provider prefix does not bypass safe mapping", async () => {
    const rawError = [
      "Provider returned raw response",
      "sk-test-key-12345",
      "ep-test-model",
      "https://api.test.example.com/v1",
      "super-confidential-resume-content-secret",
    ].join(" ");
    const fetchFn = makeMockFetchError(new Error(rawError));

    const client = new OpenAICompatibleClient({
      config: makeReadyConfig(),
      fetchFn,
    });

    await assert.rejects(
      () => client.complete({
        promptTemplateId: "test",
        prompt: "super-confidential-resume-content-secret",
      }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        const msg = err.message;
        assert.equal(msg, "Provider returned an unexpected error.");
        assert.ok(!msg.includes("sk-test-key-12345"), "must not leak apiKey");
        assert.ok(!msg.includes("ep-test-model"), "must not leak modelId");
        assert.ok(!msg.includes("api.test.example.com"), "must not leak endpoint");
        assert.ok(!msg.includes("super-confidential"), "must not leak prompt");
        return true;
      },
    );
  });
});

describe("OpenAICompatibleClient — no real network", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("uses injected fetchFn, never global fetch", async () => {
    let globalCalled = false;
    globalThis.fetch = () => {
      globalCalled = true;
      return Promise.resolve({} as Response);
    };

    const fetchFn = makeMockFetch({
      status: 200,
      body: {
        choices: [{ message: { role: "assistant", content: "ok" } }],
      },
    });

    const client = new OpenAICompatibleClient({
      config: makeReadyConfig(),
      fetchFn,
    });

    await client.complete({ promptTemplateId: "test", prompt: "hello" });

    assert.equal(globalCalled, false);
    assert.equal(fetchFn.calls.length, 1);

  });
});
