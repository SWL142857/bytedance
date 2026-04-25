import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computePromptHash, buildAgentRun, getGitCommitHash } from "../../src/agents/base-agent.js";
import { DeterministicLlmClient } from "../../src/llm/deterministic-client.js";

describe("base agent — computePromptHash", () => {
  it("returns deterministic 16-char hex string", () => {
    const hash = computePromptHash("template_v1", "hello world");
    assert.equal(hash.length, 16);
    assert.ok(/^[0-9a-f]+$/.test(hash), "Hash should be hex");
  });

  it("same input produces same hash", () => {
    const a = computePromptHash("t1", "prompt");
    const b = computePromptHash("t1", "prompt");
    assert.equal(a, b);
  });

  it("different inputs produce different hashes", () => {
    const a = computePromptHash("t1", "prompt1");
    const b = computePromptHash("t1", "prompt2");
    assert.notEqual(a, b);
  });
});

describe("base agent — getGitCommitHash", () => {
  it("returns unknown when env not set", () => {
    delete process.env.HIRELOOP_GIT_COMMIT;
    assert.equal(getGitCommitHash(), "unknown");
  });

  it("returns env value when set", () => {
    process.env.HIRELOOP_GIT_COMMIT = "abc1234";
    assert.equal(getGitCommitHash(), "abc1234");
    delete process.env.HIRELOOP_GIT_COMMIT;
  });
});

describe("base agent — buildAgentRun", () => {
  it("builds a valid AgentRunRecord", () => {
    const run = buildAgentRun({
      agentName: "resume_parser",
      entityType: "candidate",
      entityRef: "cand_001",
      inputSummary: "test summary",
      outputJson: "{}",
      promptTemplateId: "v1",
      promptHash: "abcd1234efgh5678",
      statusBefore: "new",
      statusAfter: "parsed",
      runStatus: "success",
      durationMs: 100,
    });
    assert.equal(run.agent_name, "resume_parser");
    assert.equal(run.entity_type, "candidate");
    assert.equal(run.run_status, "success");
    assert.equal(run.retry_count, 0);
    assert.ok(run.run_id.startsWith("run_resume_parser_"));
    assert.equal(run.status_before, "new");
    assert.equal(run.status_after, "parsed");
  });

  it("includes error_message when runStatus is failed", () => {
    const run = buildAgentRun({
      agentName: "screening",
      entityType: "candidate",
      entityRef: "cand_001",
      inputSummary: "test",
      outputJson: "{}",
      promptTemplateId: "v1",
      promptHash: "abcd1234",
      runStatus: "failed",
      errorMessage: "Schema validation failed",
      durationMs: 50,
    });
    assert.equal(run.run_status, "failed");
    assert.equal(run.error_message, "Schema validation failed");
  });
});

describe("deterministic client", () => {
  it("returns fixed response for known template", async () => {
    const client = new DeterministicLlmClient();
    const resp = await client.complete({ promptTemplateId: "resume_parser_v1", prompt: "test" });
    const parsed = JSON.parse(resp.content);
    assert.ok(Array.isArray(parsed.facts));
    assert.equal(parsed.parseStatus, "success");
  });

  it("throws for unknown template", async () => {
    const client = new DeterministicLlmClient();
    await assert.rejects(
      () => client.complete({ promptTemplateId: "nonexistent", prompt: "test" }),
      (err: unknown) => err instanceof Error && err.message.includes("nonexistent"),
    );
  });

  it("accepts custom overrides", async () => {
    const client = new DeterministicLlmClient({
      custom_template: JSON.stringify({ result: "custom" }),
    });
    const resp = await client.complete({ promptTemplateId: "custom_template", prompt: "test" });
    const parsed = JSON.parse(resp.content);
    assert.equal(parsed.result, "custom");
  });
});
