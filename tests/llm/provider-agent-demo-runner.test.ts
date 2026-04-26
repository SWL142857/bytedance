import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildProviderAgentDemoPlan,
  runProviderAgentDemo,
  type ProviderAgentDemoOptions,
} from "../../src/llm/provider-agent-demo-runner.js";
import type { ProviderAdapterConfig } from "../../src/llm/provider-adapter.js";
import type { LlmClient, LlmResponse } from "../../src/llm/client.js";

function makeReadyConfig(): ProviderAdapterConfig {
  return {
    enabled: true,
    providerName: "test-provider",
    endpoint: "https://api.test.example.com/v1",
    modelId: "ep-test-model",
    apiKey: "sk-test-key-12345",
  };
}

function makeExecuteOptions(overrides: Partial<ProviderAgentDemoOptions> = {}): ProviderAgentDemoOptions {
  return {
    useProvider: true,
    execute: true,
    confirm: "EXECUTE_PROVIDER_AGENT_DEMO",
    ...overrides,
  };
}

const SAMPLE_RESUME_TEXT =
  "AI Product Manager with 6 years experience in technology sector. " +
  "Skills: product roadmapping, SQL, Python basics, A/B testing.";

function makeMockLlmClient(content: string): LlmClient {
  return {
    async complete(request: { promptTemplateId: string; prompt: string }): Promise<LlmResponse> {
      return { content, promptTemplateId: request.promptTemplateId };
    },
  };
}

describe("Provider agent demo — dry-run defaults", () => {
  it("default options without --use-provider returns planned dry-run", () => {
    const plan = buildProviderAgentDemoPlan(makeReadyConfig(), {
      useProvider: false,
      execute: false,
    });
    assert.equal(plan.mode, "dry_run");
    assert.equal(plan.status, "planned");
    assert.equal(plan.commandCount, null);
  });

  it("--use-provider without --execute returns planned dry-run", () => {
    const plan = buildProviderAgentDemoPlan(makeReadyConfig(), {
      useProvider: true,
      execute: false,
    });
    assert.equal(plan.mode, "dry_run");
    assert.equal(plan.status, "planned");
    assert.equal(plan.commandCount, null);
  });
});

describe("Provider agent demo — blocked paths (no fetch)", () => {
  it("--execute without --use-provider is blocked", () => {
    const plan = buildProviderAgentDemoPlan(makeReadyConfig(), makeExecuteOptions({ useProvider: false }));
    assert.equal(plan.status, "blocked");
    assert.ok(plan.blockedReasons.length > 0);
  });

  it("--use-provider --execute without confirm is blocked", () => {
    const plan = buildProviderAgentDemoPlan(makeReadyConfig(), makeExecuteOptions({ confirm: undefined }));
    assert.equal(plan.status, "blocked");
    assert.ok(plan.blockedReasons.some((r) => r.includes("Confirmation")));
  });

  it("--use-provider --execute with wrong confirm is blocked", () => {
    const plan = buildProviderAgentDemoPlan(makeReadyConfig(), makeExecuteOptions({ confirm: "WRONG" }));
    assert.equal(plan.status, "blocked");
    assert.ok(plan.blockedReasons.some((r) => r.includes("Confirmation")));
  });

  it("missing endpoint is blocked", () => {
    const config = { ...makeReadyConfig(), endpoint: null };
    const plan = buildProviderAgentDemoPlan(config, makeExecuteOptions());
    assert.equal(plan.status, "blocked");
    assert.ok(plan.blockedReasons.some((r) => r.includes("endpoint")));
  });

  it("missing modelId is blocked", () => {
    const config = { ...makeReadyConfig(), modelId: null };
    const plan = buildProviderAgentDemoPlan(config, makeExecuteOptions());
    assert.equal(plan.status, "blocked");
    assert.ok(plan.blockedReasons.some((r) => r.includes("model ID")));
  });

  it("missing apiKey is blocked", () => {
    const config = { ...makeReadyConfig(), apiKey: null };
    const plan = buildProviderAgentDemoPlan(config, makeExecuteOptions());
    assert.equal(plan.status, "blocked");
    assert.ok(plan.blockedReasons.some((r) => r.includes("API key")));
  });

  it("all env missing is blocked with multiple reasons", () => {
    const config: ProviderAdapterConfig = { enabled: true, providerName: "test" };
    const plan = buildProviderAgentDemoPlan(config, makeExecuteOptions());
    assert.equal(plan.status, "blocked");
    assert.ok(plan.blockedReasons.length >= 3);
  });
});

describe("Provider agent demo — blocked paths never call fetch", () => {
  it("runProviderAgentDemo with blocked config does not call client", async () => {
    let clientCalled = false;
    const client: LlmClient = {
      async complete() {
        clientCalled = true;
        return { content: "{}", promptTemplateId: "x" };
      },
    };

    const config: ProviderAdapterConfig = { enabled: true, providerName: "test" };
    const result = await runProviderAgentDemo(config, makeExecuteOptions(), client);

    assert.equal(result.status, "blocked");
    assert.equal(clientCalled, false);
  });

  it("runProviderAgentDemo without --use-provider does not call client", async () => {
    let clientCalled = false;
    const client: LlmClient = {
      async complete() {
        clientCalled = true;
        return { content: "{}", promptTemplateId: "x" };
      },
    };

    const result = await runProviderAgentDemo(
      makeReadyConfig(),
      { useProvider: false, execute: true },
      client,
    );

    assert.equal(result.status, "blocked");
    assert.equal(clientCalled, false);
  });

  it("runProviderAgentDemo without confirm does not call client", async () => {
    let clientCalled = false;
    const client: LlmClient = {
      async complete() {
        clientCalled = true;
        return { content: "{}", promptTemplateId: "x" };
      },
    };

    const result = await runProviderAgentDemo(
      makeReadyConfig(),
      makeExecuteOptions({ confirm: undefined }),
      client,
    );

    assert.equal(result.status, "blocked");
    assert.equal(clientCalled, false);
  });
});

describe("Provider agent demo — execute success with mock provider", () => {
  it("mocked provider produces valid Resume Parser command plan", async () => {
    const validOutput = JSON.stringify({
      facts: [
        { factType: "work_experience", factText: "6 years PM", sourceExcerpt: null, confidence: "high" },
        { factType: "skill", factText: "SQL", sourceExcerpt: null, confidence: "high" },
      ],
      parseStatus: "success",
    });
    const client = makeMockLlmClient(validOutput);

    const result = await runProviderAgentDemo(makeReadyConfig(), makeExecuteOptions(), client);

    assert.equal(result.status, "success");
    assert.equal(result.mode, "execute");
    assert.ok(result.commandCount !== null && result.commandCount > 0);
    assert.equal(result.agentRunStatus, "success");
    assert.equal(result.retryCount, 0);
  });

  it("result contains safe fields only", async () => {
    const validOutput = JSON.stringify({
      facts: [{ factType: "skill", factText: "Python", sourceExcerpt: null, confidence: "high" }],
      parseStatus: "success",
    });
    const client = makeMockLlmClient(validOutput);

    const result = await runProviderAgentDemo(makeReadyConfig(), makeExecuteOptions(), client);
    const json = JSON.stringify(result);

    assert.ok(!json.includes("sk-test-key-12345"), "no apiKey");
    assert.ok(!json.includes("api.test.example.com"), "no endpoint");
    assert.ok(!json.includes("ep-test-model"), "no modelId");
    assert.ok(!json.includes("Bearer"), "no authorization header");
    assert.ok(!json.includes("Authorization"), "no authorization header");
    assert.ok(!json.includes(SAMPLE_RESUME_TEXT), "no resume text");
  });
});

describe("Provider agent demo — execute with agent failure", () => {
  it("mocked provider returning invalid JSON fails safely", async () => {
    const client = makeMockLlmClient("not valid json {{{");

    const result = await runProviderAgentDemo(makeReadyConfig(), makeExecuteOptions(), client);

    assert.equal(result.status, "failed");
    assert.equal(result.mode, "execute");
    assert.equal(result.agentRunStatus, "failed");
    assert.ok(result.commandCount !== null && result.commandCount >= 1);
  });

  it("failure agent result does not leak secrets", async () => {
    const client = makeMockLlmClient("bad json");

    const result = await runProviderAgentDemo(makeReadyConfig(), makeExecuteOptions(), client);
    const json = JSON.stringify(result);

    assert.ok(!json.includes("sk-test-key-12345"), "no apiKey in failure");
    assert.ok(!json.includes("api.test.example.com"), "no endpoint in failure");
    assert.ok(!json.includes("ep-test-model"), "no modelId in failure");
  });

  it("failure agent result does not contain raw output or prompt", async () => {
    const rawSecretOutput = "raw-secret-model-output-with-sensitive-data";
    const client = makeMockLlmClient(rawSecretOutput);

    const result = await runProviderAgentDemo(makeReadyConfig(), makeExecuteOptions(), client);
    const json = JSON.stringify(result);

    assert.ok(!json.includes(rawSecretOutput), "no raw model output in failure");
    assert.ok(!json.includes(SAMPLE_RESUME_TEXT), "no resume text in failure");
  });

  it("unexpected thrown error is mapped to safe summary", async () => {
    const client: LlmClient = {
      async complete() {
        throw new Error("raw failure with sk-test-key-12345 https://api.test.example.com/v1 ep-test-model");
      },
    };

    const result = await runProviderAgentDemo(makeReadyConfig(), makeExecuteOptions(), client);
    const json = JSON.stringify(result);

    assert.equal(result.status, "failed");
    assert.ok(!json.includes("sk-test-key-12345"), "no apiKey in thrown failure");
    assert.ok(!json.includes("api.test.example.com"), "no endpoint in thrown failure");
    assert.ok(!json.includes("ep-test-model"), "no modelId in thrown failure");
  });
});

describe("Provider agent demo — output safety", () => {
  it("dry-run output does not contain secrets", () => {
    const plan = buildProviderAgentDemoPlan(makeReadyConfig(), {
      useProvider: true,
      execute: false,
    });
    const json = JSON.stringify(plan);

    assert.ok(!json.includes("sk-test-key-12345"), "no apiKey");
    assert.ok(!json.includes("api.test.example.com"), "no endpoint");
    assert.ok(!json.includes("ep-test-model"), "no modelId");
  });

  it("blocked output does not contain secrets", () => {
    const plan = buildProviderAgentDemoPlan(
      makeReadyConfig(),
      makeExecuteOptions({ confirm: undefined }),
    );
    const json = JSON.stringify(plan);

    assert.ok(!json.includes("sk-test-key-12345"), "no apiKey");
    assert.ok(!json.includes("api.test.example.com"), "no endpoint");
    assert.ok(!json.includes("ep-test-model"), "no modelId");
  });

  it("no result field contains Base record IDs", async () => {
    const validOutput = JSON.stringify({
      facts: [{ factType: "skill", factText: "Python", sourceExcerpt: null, confidence: "high" }],
      parseStatus: "success",
    });
    const client = makeMockLlmClient(validOutput);

    const result = await runProviderAgentDemo(makeReadyConfig(), makeExecuteOptions(), client);
    const json = JSON.stringify(result);

    assert.ok(!json.includes("rec_demo"), "no demo record IDs");
    assert.ok(!json.includes("recCand"), "no candidate record IDs");
  });
});

describe("Provider agent demo — isolation from main demo path", () => {
  it("default options without --use-provider is deterministic-safe", () => {
    const plan = buildProviderAgentDemoPlan(makeReadyConfig(), {
      useProvider: false,
      execute: false,
    });
    assert.equal(plan.mode, "dry_run");
    assert.equal(plan.canCallExternalModel, false);
    assert.ok(plan.safeSummary.includes("not using provider"));
  });

  it("does not import OpenAICompatibleClient in agent source files", async () => {
    const { readFile } = await import("node:fs/promises");
    const { readdir } = await import("node:fs/promises");
    const path = await import("node:path");

    const agentsDir = path.resolve("src/agents");
    const files = await readdir(agentsDir);
    const agentFiles = files.filter((f) => f.endsWith(".ts") && !f.includes(".test."));

    for (const file of agentFiles) {
      const content = await readFile(path.join(agentsDir, file), "utf-8");
      assert.ok(!content.includes("OpenAICompatible"), `${file} must not import OpenAICompatibleClient`);
    }
  });
});
