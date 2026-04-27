import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DeterministicLlmClient } from "../../src/llm/deterministic-client.js";
import { OpenAICompatibleClient } from "../../src/llm/openai-compatible-client.js";
import fs from "node:fs";
import path from "node:path";

describe("Integration boundary — deterministic client is default", () => {
  it("DeterministicLlmClient completes without any network", async () => {
    const client = new DeterministicLlmClient();
    const result = await client.complete({
      promptTemplateId: "resume_parser_v1",
      prompt: "test",
    });
    assert.ok(result.content);
    assert.equal(result.promptTemplateId, "resume_parser_v1");
  });

  it("DeterministicLlmClient handles all five agent template IDs", async () => {
    const client = new DeterministicLlmClient();
    const ids = [
      "resume_parser_v1",
      "screening_v1",
      "interview_kit_v1",
      "hr_coordinator_v1",
      "analytics_v1",
    ];

    for (const id of ids) {
      const result = await client.complete({ promptTemplateId: id, prompt: "test" });
      assert.ok(result.content, `DeterministicLlmClient must handle ${id}`);
      assert.equal(result.promptTemplateId, id);
    }
  });

  it("OpenAICompatibleClient is not imported by any business agent", () => {
    const agentsDir = path.resolve("src/agents");
    const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".ts") && !f.includes(".test."));

    for (const file of files) {
      const content = fs.readFileSync(path.join(agentsDir, file), "utf-8");
      assert.ok(
        !content.includes("OpenAICompatible"),
        `Agent file ${file} must not import OpenAICompatibleClient`,
      );
    }
  });

  it("DisabledProviderClient is not imported by any business agent", () => {
    const agentsDir = path.resolve("src/agents");
    const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".ts") && !f.includes(".test."));

    for (const file of files) {
      const content = fs.readFileSync(path.join(agentsDir, file), "utf-8");
      assert.ok(
        !content.includes("DisabledProvider"),
        `Agent file ${file} must not import DisabledProviderClient`,
      );
    }
  });

  it("Demo scripts use DeterministicLlmClient, not OpenAICompatibleClient", () => {
    const scriptsDir = path.resolve("scripts");
    const files = fs.readdirSync(scriptsDir).filter((f) => f.endsWith(".ts"));

    // Scripts that legitimately use provider client when properly gated
    const allowProviderImport = new Set([
      "run-live-agent-dataset.ts",
    ]);

    for (const file of files) {
      if (allowProviderImport.has(file)) continue;

      const content = fs.readFileSync(path.join(scriptsDir, file), "utf-8");
      if (content.includes("LlmClient") || content.includes("llm")) {
        assert.ok(
          !content.includes("OpenAICompatible"),
          `Script ${file} must not use OpenAICompatibleClient`,
        );
      }
    }
  });

  it("OpenAICompatibleClient with disabled config does not call fetch", async () => {
    let fetchCalled = false;
    const fetchFn = async () => {
      fetchCalled = true;
      return {} as Response;
    };

    const client = new OpenAICompatibleClient({
      config: { enabled: false, providerName: "test" },
      fetchFn,
    });

    await assert.rejects(() =>
      client.complete({ promptTemplateId: "test", prompt: "hello" }),
    );
    assert.equal(fetchCalled, false);
  });
});
