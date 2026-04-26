import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runHrCoordinator, type HrCoordinatorInput } from "../../src/agents/hr-coordinator.js";
import { DeterministicLlmClient } from "../../src/llm/deterministic-client.js";

const VALID_INPUT: HrCoordinatorInput = {
  candidateRecordId: "recCand001",
  candidateId: "cand_001",
  jobId: "job_001",
  screeningRecommendation: "strong_match",
  focusAreas: ["ML system design", "feature prioritization"],
  riskChecks: ["Check for over-reliance on single metric"],
  fromStatus: "interview_kit_ready",
};

describe("hr coordinator agent — successful handoff", () => {
  it("generates Agent Run with correct metadata", async () => {
    const client = new DeterministicLlmClient();
    const result = await runHrCoordinator(client, VALID_INPUT);
    assert.equal(result.agentRun.agent_name, "hr_coordinator");
    assert.equal(result.agentRun.entity_type, "candidate");
    assert.equal(result.agentRun.entity_ref, "cand_001");
    assert.equal(result.agentRun.run_status, "success");
    assert.equal(result.agentRun.status_after, "decision_pending");
  });

  it("generates status update interview_kit_ready -> decision_pending", async () => {
    const client = new DeterministicLlmClient();
    const result = await runHrCoordinator(client, VALID_INPUT);
    const statusCmd = result.commands.find((c) => c.description.includes("interview_kit_ready -> decision_pending"));
    assert.ok(statusCmd, "Missing status update command");
  });

  it("Agent Run command is first in commands list", async () => {
    const client = new DeterministicLlmClient();
    const result = await runHrCoordinator(client, VALID_INPUT);
    assert.ok(result.commands.length > 0, "Should have commands");
    assert.ok(result.commands[0]!.description.includes("\"Agent Runs\""), "First command should be Agent Run append");
  });

  it("status update is last business command", async () => {
    const client = new DeterministicLlmClient();
    const result = await runHrCoordinator(client, VALID_INPUT);
    assert.ok(result.commands.length > 0);
    const lastCmd = result.commands[result.commands.length - 1];
    assert.ok(lastCmd);
    assert.ok(lastCmd!.description.includes("interview_kit_ready -> decision_pending"), "Last command should be status update");
  });

  it("output_json contains handoffSummary and checklist", async () => {
    const client = new DeterministicLlmClient();
    const result = await runHrCoordinator(client, VALID_INPUT);
    assert.ok(result.agentRun.output_json);
    const output = JSON.parse(result.agentRun.output_json!);
    assert.ok(typeof output.handoffSummary === "string");
    assert.equal(output.nextStep, "human_decision");
    assert.ok(Array.isArray(output.coordinatorChecklist));
    assert.ok(output.coordinatorChecklist.length > 0);
  });

  it("does not produce offer or rejected status", async () => {
    const client = new DeterministicLlmClient();
    const result = await runHrCoordinator(client, VALID_INPUT);
    assert.notEqual(result.agentRun.status_after, "offer");
    assert.notEqual(result.agentRun.status_after, "rejected");
    const allDescs = result.commands.map((c) => c.description).join(" ");
    assert.ok(!allDescs.includes("-> offer"), "Should not produce offer");
    assert.ok(!allDescs.includes("-> rejected"), "Should not produce rejected");
  });

  it("input_summary does not contain focus areas or risk checks text", async () => {
    const client = new DeterministicLlmClient();
    const result = await runHrCoordinator(client, VALID_INPUT);
    assert.ok(!result.agentRun.input_summary.includes(VALID_INPUT.focusAreas[0]!));
    assert.ok(result.agentRun.input_summary.includes("cand_001"));
    assert.ok(result.agentRun.input_summary.includes("focusAreas=2"));
    assert.ok(result.agentRun.input_summary.includes("riskChecks=1"));
  });

  it("Agent Run does not contain forbidden keys", async () => {
    const client = new DeterministicLlmClient();
    const result = await runHrCoordinator(client, VALID_INPUT);
    const forbidden = ["reasoning_chain", "raw_resume", "full_resume", "raw_prompt", "thinking", "chain_of_thought"];
    const runJson = JSON.stringify(result.agentRun);
    for (const key of forbidden) {
      assert.ok(!runJson.includes(key), `Agent Run contains forbidden key: ${key}`);
    }
  });

  it("agent does not execute runPlan — only returns commands", async () => {
    const client = new DeterministicLlmClient();
    const result = await runHrCoordinator(client, VALID_INPUT);
    for (const cmd of result.commands) {
      assert.equal(cmd.command, "lark-cli");
      assert.ok(Array.isArray(cmd.args));
    }
  });
});

describe("hr coordinator agent — schema validation failure", () => {
  it("produces failed Agent Run when LLM returns invalid JSON", async () => {
    const client = new DeterministicLlmClient({
      hr_coordinator_v1: "not valid json {{{",
    });
    const result = await runHrCoordinator(client, VALID_INPUT);
    assert.equal(result.agentRun.run_status, "failed");
    assert.ok(result.agentRun.error_message);
    assert.ok(result.agentRun.error_message!.includes("JSON") || result.agentRun.error_message!.includes("parse"),
      `Unexpected error: ${result.agentRun.error_message}`);
  });

  it("produces failed Agent Run when LLM returns schema-invalid output", async () => {
    const client = new DeterministicLlmClient({
      hr_coordinator_v1: JSON.stringify({ handoffSummary: 123, nextStep: "wrong" }),
    });
    const result = await runHrCoordinator(client, VALID_INPUT);
    assert.equal(result.agentRun.run_status, "failed");
    assert.ok(result.agentRun.error_message);
    assert.equal(result.agentRun.status_after, "interview_kit_ready");
  });

  it("does not generate status update on failure", async () => {
    const client = new DeterministicLlmClient({
      hr_coordinator_v1: "bad json",
    });
    const result = await runHrCoordinator(client, VALID_INPUT);
    const statusCmd = result.commands.find((c) => c.description.includes("interview_kit_ready -> decision_pending"));
    assert.ok(!statusCmd, "Should not generate status update on failure");
  });

  it("rejects forbidden keys in output", async () => {
    const client = new DeterministicLlmClient({
      hr_coordinator_v1: JSON.stringify({
        handoffSummary: "ok",
        nextStep: "human_decision",
        coordinatorChecklist: ["item1"],
        reasoning_chain: "secret",
      }),
    });
    const result = await runHrCoordinator(client, VALID_INPUT);
    assert.equal(result.agentRun.run_status, "failed");
    assert.ok(result.agentRun.error_message!.includes("schema") || result.agentRun.error_message!.includes("Schema"));
  });

  it("still generates Agent Run on failure", async () => {
    const client = new DeterministicLlmClient({
      hr_coordinator_v1: "bad json",
    });
    const result = await runHrCoordinator(client, VALID_INPUT);
    assert.equal(result.agentRun.agent_name, "hr_coordinator");
    assert.equal(result.agentRun.run_status, "failed");
    assert.ok(result.agentRun.error_message);
  });
});

describe("hr coordinator agent — LLM call error", () => {
  it("produces failed Agent Run when client.complete throws", async () => {
    const client = {
      async complete() { throw new Error("Network timeout"); },
    };
    const result = await runHrCoordinator(client, VALID_INPUT);
    assert.equal(result.agentRun.run_status, "failed");
    assert.equal(result.agentRun.status_after, "interview_kit_ready");
    assert.ok(result.agentRun.error_message!.includes("Network timeout"));
    assert.equal(result.commands.length, 1, "Should only have Agent Run on LLM error");
    assert.ok(result.commands[0]!.description.includes("\"Agent Runs\""));
  });

  it("error_message does not contain focus areas text", async () => {
    const client = {
      async complete() { throw new Error("Failed: " + VALID_INPUT.focusAreas.join(", ")); },
    };
    const result = await runHrCoordinator(client, VALID_INPUT);
    for (const area of VALID_INPUT.focusAreas) {
      assert.ok(!result.agentRun.error_message!.includes(area!), "error_message must not contain focus area text");
    }
  });
});

describe("hr coordinator agent — invalid record ID", () => {
  it("throws before calling LLM when candidateRecordId is a business ID", async () => {
    let llmCalled = false;
    const client = {
      async complete() { llmCalled = true; return { content: "{}", promptTemplateId: "x" }; },
    };
    const input: HrCoordinatorInput = {
      ...VALID_INPUT,
      candidateRecordId: "cand_demo_001",
    };
    await assert.rejects(
      () => runHrCoordinator(client, input),
      (err: unknown) => err instanceof Error && err.message.includes("rec_xxx"),
    );
    assert.ok(!llmCalled, "LLM should not be called when candidateRecordId is invalid");
  });
});
