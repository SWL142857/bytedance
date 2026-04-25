import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runScreener, type ScreeningInput } from "../../src/agents/screener.js";
import { DeterministicLlmClient } from "../../src/llm/deterministic-client.js";

const VALID_INPUT: ScreeningInput = {
  candidateRecordId: "recCand001",
  jobRecordId: "recJob001",
  candidateId: "cand_001",
  jobId: "job_001",
  resumeFacts: [
    { factType: "skill", factText: "Python, SQL", confidence: "high" },
    { factType: "work_experience", factText: "5 years PM", confidence: "high" },
  ],
  jobRequirements: "5+ years in product management",
  jobRubric: "Technical depth, product sense, communication",
  fromStatus: "parsed",
};

describe("screener agent — successful screening", () => {
  it("generates evaluation upsert commands for each dimension", async () => {
    const client = new DeterministicLlmClient();
    const result = await runScreener(client, VALID_INPUT);
    const evalCmds = result.commands.filter((c) => c.description.includes("\"Evaluations\""));
    assert.ok(evalCmds.length >= 2, `Expected >= 2 evaluation upserts, got ${evalCmds.length}`);
  });

  it("generates status update parsed -> screened", async () => {
    const client = new DeterministicLlmClient();
    const result = await runScreener(client, VALID_INPUT);
    const statusCmd = result.commands.find((c) => c.description.includes("parsed -> screened"));
    assert.ok(statusCmd, "Missing status update command");
  });

  it("generates candidate update with screening_recommendation", async () => {
    const client = new DeterministicLlmClient();
    const result = await runScreener(client, VALID_INPUT);
    const candUpdateCmd = result.commands.find((c) =>
      c.description.includes("\"Candidates\"") && c.args.includes("--record-id"),
    );
    assert.ok(candUpdateCmd, "Missing candidate update with --record-id");
    const jsonIdx = candUpdateCmd!.args.indexOf("--json");
    const jsonVal = candUpdateCmd!.args[jsonIdx + 1];
    assert.ok(jsonVal, "--json value must exist");
    const parsed = JSON.parse(jsonVal);
    assert.ok(parsed.screening_recommendation, "Missing screening_recommendation");
  });

  it("generates Agent Run with correct metadata", async () => {
    const client = new DeterministicLlmClient();
    const result = await runScreener(client, VALID_INPUT);
    assert.equal(result.agentRun.agent_name, "screening");
    assert.equal(result.agentRun.entity_ref, "cand_001");
    assert.equal(result.agentRun.run_status, "success");
    assert.equal(result.agentRun.status_after, "screened");
  });

  it("evaluation link fields use rec_xxx record IDs", async () => {
    const client = new DeterministicLlmClient();
    const result = await runScreener(client, VALID_INPUT);
    const evalCmds = result.commands.filter((c) => c.description.includes("\"Evaluations\""));
    for (const cmd of evalCmds) {
      const jsonIdx = cmd.args.indexOf("--json");
      const jsonArg = cmd.args[jsonIdx + 1];
      assert.ok(jsonArg);
      const parsed = JSON.parse(jsonArg!);
      assert.ok(Array.isArray(parsed.candidate), "candidate link should be array");
      assert.ok(parsed.candidate[0].id.startsWith("rec"), "candidate link should use rec_xxx");
      assert.ok(Array.isArray(parsed.job), "job link should be array");
      assert.ok(parsed.job[0].id.startsWith("rec"), "job link should use rec_xxx");
    }
  });

  it("recommendation is a valid three-tier value", async () => {
    const client = new DeterministicLlmClient();
    const result = await runScreener(client, VALID_INPUT);
    assert.ok(result.agentRun.output_json, "output_json must exist");
    const output = JSON.parse(result.agentRun.output_json);
    assert.ok(["strong_match", "review_needed", "weak_match"].includes(output.recommendation));
  });

  it("screener does not produce offer/rejected status", async () => {
    const client = new DeterministicLlmClient();
    const result = await runScreener(client, VALID_INPUT);
    assert.notEqual(result.agentRun.status_after, "offer");
    assert.notEqual(result.agentRun.status_after, "rejected");
    const allDescs = result.commands.map((c) => c.description).join(" ");
    assert.ok(!allDescs.includes("-> offer"), "Screener should not produce offer");
    assert.ok(!allDescs.includes("-> rejected"), "Screener should not produce rejected");
  });

  it("Agent Run does not contain forbidden keys", async () => {
    const client = new DeterministicLlmClient();
    const result = await runScreener(client, VALID_INPUT);
    const forbidden = ["reasoning_chain", "raw_resume", "full_resume", "raw_prompt", "thinking", "chain_of_thought"];
    const runJson = JSON.stringify(result.agentRun);
    for (const key of forbidden) {
      assert.ok(!runJson.includes(key), `Agent Run contains forbidden key: ${key}`);
    }
  });

  it("input_summary does not contain full resume or job requirements", async () => {
    const client = new DeterministicLlmClient();
    const result = await runScreener(client, VALID_INPUT);
    assert.ok(!result.agentRun.input_summary.includes(VALID_INPUT.jobRequirements));
    assert.ok(result.agentRun.input_summary.includes("cand_001"));
    assert.ok(result.agentRun.input_summary.includes("job_001"));
  });

  it("agent does not execute runPlan — only returns commands", async () => {
    const client = new DeterministicLlmClient();
    const result = await runScreener(client, VALID_INPUT);
    for (const cmd of result.commands) {
      assert.equal(cmd.command, "lark-cli");
      assert.ok(Array.isArray(cmd.args));
    }
  });

  it("Agent Run command is first in commands list", async () => {
    const client = new DeterministicLlmClient();
    const result = await runScreener(client, VALID_INPUT);
    assert.ok(result.commands.length > 0, "Should have commands");
    assert.ok(result.commands[0]!.description.includes("\"Agent Runs\""), "First command should be Agent Run append");
  });

  it("status update is last business command", async () => {
    const client = new DeterministicLlmClient();
    const result = await runScreener(client, VALID_INPUT);
    assert.ok(result.commands.length > 0, "Should have commands");
    const lastCmd = result.commands[result.commands.length - 1];
    assert.ok(lastCmd, "Last command should exist");
    assert.ok(lastCmd!.description.includes("parsed -> screened"), "Last command should be status update");
  });
});

describe("screener agent — schema validation failure", () => {
  it("produces failed Agent Run when LLM returns invalid schema", async () => {
    const client = new DeterministicLlmClient({
      screening_v1: JSON.stringify({ recommendation: "invalid_value", dimensionRatings: [], fairnessFlags: [] }),
    });
    const result = await runScreener(client, VALID_INPUT);
    assert.equal(result.agentRun.run_status, "failed");
    assert.ok(result.agentRun.error_message);
    assert.equal(result.agentRun.status_after, "parsed");
  });

  it("does not generate evaluation commands on failure", async () => {
    const client = new DeterministicLlmClient({
      screening_v1: "bad json",
    });
    const result = await runScreener(client, VALID_INPUT);
    const evalCmds = result.commands.filter((c) => c.description.includes("\"Evaluations\""));
    assert.equal(evalCmds.length, 0);
  });

  it("still generates Agent Run on failure", async () => {
    const client = new DeterministicLlmClient({
      screening_v1: "bad json",
    });
    const result = await runScreener(client, VALID_INPUT);
    assert.equal(result.agentRun.agent_name, "screening");
    assert.equal(result.agentRun.run_status, "failed");
    assert.ok(result.agentRun.error_message);
  });
});

describe("screener agent — LLM call error", () => {
  it("produces failed Agent Run when client.complete throws", async () => {
    const client = {
      async complete() { throw new Error("Rate limit exceeded"); },
    };
    const result = await runScreener(client, VALID_INPUT);
    assert.equal(result.agentRun.run_status, "failed");
    assert.equal(result.agentRun.status_after, "parsed");
    assert.ok(result.agentRun.error_message!.includes("Rate limit exceeded"));
    assert.equal(result.commands.length, 1, "Should only have Agent Run on LLM error");
    assert.ok(result.commands[0]!.description.includes("\"Agent Runs\""));
  });

  it("output_json on LLM error is structured failure, not raw input", async () => {
    const client = {
      async complete() { throw new Error("Service unavailable"); },
    };
    const result = await runScreener(client, VALID_INPUT);
    const output = JSON.parse(result.agentRun.output_json!);
    assert.ok(["strong_match", "review_needed", "weak_match"].includes(output.recommendation));
    assert.ok(Array.isArray(output.dimensionRatings));
    assert.ok(!JSON.stringify(output).includes(VALID_INPUT.jobRequirements), "output_json must not contain job requirements");
  });

  it("error_message does not contain full input text", async () => {
    const client = {
      async complete() { throw new Error("Failed: " + VALID_INPUT.jobRequirements); },
    };
    const result = await runScreener(client, VALID_INPUT);
    assert.ok(!result.agentRun.error_message!.includes(VALID_INPUT.jobRequirements), "error_message must not contain job requirements");
  });
});

describe("screener agent — invalid record ID", () => {
  it("throws before calling LLM when candidateRecordId is a business ID", async () => {
    let llmCalled = false;
    const client = {
      async complete() { llmCalled = true; return { content: "{}", promptTemplateId: "x" }; },
    };
    const input: ScreeningInput = {
      ...VALID_INPUT,
      candidateRecordId: "cand_demo_001",
    };
    await assert.rejects(
      () => runScreener(client, input),
      (err: unknown) => err instanceof Error && err.message.includes("rec_xxx"),
    );
    assert.ok(!llmCalled, "LLM should not be called when candidateRecordId is invalid");
  });

  it("throws before calling LLM when jobRecordId is a business ID", async () => {
    let llmCalled = false;
    const client = {
      async complete() { llmCalled = true; return { content: "{}", promptTemplateId: "x" }; },
    };
    const input: ScreeningInput = {
      ...VALID_INPUT,
      jobRecordId: "job_demo_001",
    };
    await assert.rejects(
      () => runScreener(client, input),
      (err: unknown) => err instanceof Error && err.message.includes("rec_xxx"),
    );
    assert.ok(!llmCalled, "LLM should not be called when jobRecordId is invalid");
  });
});
