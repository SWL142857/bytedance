import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runInterviewKit, type InterviewKitInput } from "../../src/agents/interview-kit.js";
import { DeterministicLlmClient } from "../../src/llm/deterministic-client.js";

const VALID_INPUT: InterviewKitInput = {
  candidateRecordId: "recCand001",
  jobRecordId: "recJob001",
  candidateId: "cand_001",
  jobId: "job_001",
  resumeFacts: [
    { factType: "skill", factText: "Python, SQL", confidence: "high" },
    { factType: "work_experience", factText: "5 years PM", confidence: "high" },
  ],
  evaluationSummary: "Technical depth: strong. Product sense: strong. Communication: medium. Recommendation: strong_match.",
  fromStatus: "screened",
};

describe("interview kit agent — successful generation", () => {
  it("generates Interview Kit upsert command", async () => {
    const client = new DeterministicLlmClient();
    const result = await runInterviewKit(client, VALID_INPUT);
    const kitCmd = result.commands.find((c) => c.description.includes("\"Interview Kits\""));
    assert.ok(kitCmd, "Missing Interview Kit upsert command");
  });

  it("Interview Kit link fields use rec_xxx record IDs", async () => {
    const client = new DeterministicLlmClient();
    const result = await runInterviewKit(client, VALID_INPUT);
    const kitCmd = result.commands.find((c) => c.description.includes("\"Interview Kits\""));
    assert.ok(kitCmd);
    const jsonIdx = kitCmd!.args.indexOf("--json");
    const jsonArg = kitCmd!.args[jsonIdx + 1];
    assert.ok(jsonArg);
    const parsed = JSON.parse(jsonArg!);
    assert.ok(Array.isArray(parsed.candidate), "candidate link should be array");
    assert.ok(parsed.candidate[0].id.startsWith("rec"), "candidate link should use rec_xxx");
    assert.ok(Array.isArray(parsed.job), "job link should be array");
    assert.ok(parsed.job[0].id.startsWith("rec"), "job link should use rec_xxx");
  });

  it("Interview Kit contains expected fields", async () => {
    const client = new DeterministicLlmClient();
    const result = await runInterviewKit(client, VALID_INPUT);
    const kitCmd = result.commands.find((c) => c.description.includes("\"Interview Kits\""));
    const jsonIdx = kitCmd!.args.indexOf("--json");
    const jsonArg = kitCmd!.args[jsonIdx + 1];
    const parsed = JSON.parse(jsonArg!);
    assert.ok(parsed.question_list, "Missing question_list");
    assert.ok(parsed.scorecard, "Missing scorecard");
    assert.ok(parsed.focus_areas, "Missing focus_areas");
    assert.equal(parsed.created_by_agent, "interview_kit");
  });

  it("generates status update screened -> interview_kit_ready", async () => {
    const client = new DeterministicLlmClient();
    const result = await runInterviewKit(client, VALID_INPUT);
    const statusCmd = result.commands.find((c) => c.description.includes("screened -> interview_kit_ready"));
    assert.ok(statusCmd, "Missing status update command");
  });

  it("generates Agent Run with correct metadata", async () => {
    const client = new DeterministicLlmClient();
    const result = await runInterviewKit(client, VALID_INPUT);
    assert.equal(result.agentRun.agent_name, "interview_kit");
    assert.equal(result.agentRun.entity_type, "candidate");
    assert.equal(result.agentRun.entity_ref, "cand_001");
    assert.equal(result.agentRun.run_status, "success");
    assert.equal(result.agentRun.status_after, "interview_kit_ready");
  });

  it("Agent Run command is first in commands list", async () => {
    const client = new DeterministicLlmClient();
    const result = await runInterviewKit(client, VALID_INPUT);
    assert.ok(result.commands.length > 0, "Should have commands");
    assert.ok(result.commands[0]!.description.includes("\"Agent Runs\""), "First command should be Agent Run append");
  });

  it("status update is last business command", async () => {
    const client = new DeterministicLlmClient();
    const result = await runInterviewKit(client, VALID_INPUT);
    assert.ok(result.commands.length > 0, "Should have commands");
    const lastCmd = result.commands[result.commands.length - 1];
    assert.ok(lastCmd, "Last command should exist");
    assert.ok(lastCmd!.description.includes("screened -> interview_kit_ready"), "Last command should be status update");
  });

  it("does not produce decision_pending / offer / rejected status", async () => {
    const client = new DeterministicLlmClient();
    const result = await runInterviewKit(client, VALID_INPUT);
    assert.notEqual(result.agentRun.status_after, "decision_pending");
    assert.notEqual(result.agentRun.status_after, "offer");
    assert.notEqual(result.agentRun.status_after, "rejected");
    const allDescs = result.commands.map((c) => c.description).join(" ");
    assert.ok(!allDescs.includes("-> decision_pending"), "Should not produce decision_pending");
    assert.ok(!allDescs.includes("-> offer"), "Should not produce offer");
    assert.ok(!allDescs.includes("-> rejected"), "Should not produce rejected");
  });

  it("input_summary does not contain full evaluationSummary", async () => {
    const client = new DeterministicLlmClient();
    const result = await runInterviewKit(client, VALID_INPUT);
    assert.ok(!result.agentRun.input_summary.includes(VALID_INPUT.evaluationSummary));
    assert.ok(result.agentRun.input_summary.includes("cand_001"));
    assert.ok(result.agentRun.input_summary.includes("job_001"));
    assert.ok(result.agentRun.input_summary.includes("evalSummaryLength="));
  });

  it("Agent Run does not contain forbidden keys", async () => {
    const client = new DeterministicLlmClient();
    const result = await runInterviewKit(client, VALID_INPUT);
    const forbidden = ["reasoning_chain", "raw_resume", "full_resume", "raw_prompt", "thinking", "chain_of_thought"];
    const runJson = JSON.stringify(result.agentRun);
    for (const key of forbidden) {
      assert.ok(!runJson.includes(key), `Agent Run contains forbidden key: ${key}`);
    }
  });

  it("commands do not contain full evaluationSummary", async () => {
    const client = new DeterministicLlmClient();
    const result = await runInterviewKit(client, VALID_INPUT);
    const allJson = result.commands
      .map((c) => { const i = c.args.indexOf("--json"); return i >= 0 ? c.args[i + 1] : ""; })
      .join(" ");
    assert.ok(!allJson.includes(VALID_INPUT.evaluationSummary), "Commands must not contain full evaluationSummary");
  });

  it("agent does not execute runPlan — only returns commands", async () => {
    const client = new DeterministicLlmClient();
    const result = await runInterviewKit(client, VALID_INPUT);
    for (const cmd of result.commands) {
      assert.equal(cmd.command, "lark-cli");
      assert.ok(Array.isArray(cmd.args));
    }
  });
});

describe("interview kit agent — schema validation failure", () => {
  it("produces failed Agent Run when LLM returns invalid JSON", async () => {
    const client = new DeterministicLlmClient({
      interview_kit_v1: "not valid json {{{",
    });
    const result = await runInterviewKit(client, VALID_INPUT);
    assert.equal(result.agentRun.run_status, "failed");
    assert.ok(result.agentRun.error_message);
    assert.ok(result.agentRun.error_message!.includes("JSON") || result.agentRun.error_message!.includes("parse"),
      `Unexpected error: ${result.agentRun.error_message}`);
  });

  it("produces failed Agent Run when LLM returns schema-invalid output", async () => {
    const client = new DeterministicLlmClient({
      interview_kit_v1: JSON.stringify({ questions: "not_an_array" }),
    });
    const result = await runInterviewKit(client, VALID_INPUT);
    assert.equal(result.agentRun.run_status, "failed");
    assert.ok(result.agentRun.error_message);
    assert.equal(result.agentRun.status_after, "screened");
  });

  it("does not generate Interview Kit or status update on failure", async () => {
    const client = new DeterministicLlmClient({
      interview_kit_v1: "bad json",
    });
    const result = await runInterviewKit(client, VALID_INPUT);
    const kitCmd = result.commands.find((c) => c.description.includes("\"Interview Kits\""));
    assert.ok(!kitCmd, "Should not generate Interview Kit on failure");
    const statusCmd = result.commands.find((c) => c.description.includes("screened -> interview_kit_ready"));
    assert.ok(!statusCmd, "Should not generate status update on failure");
  });

  it("still generates Agent Run on failure", async () => {
    const client = new DeterministicLlmClient({
      interview_kit_v1: "bad json",
    });
    const result = await runInterviewKit(client, VALID_INPUT);
    assert.equal(result.agentRun.agent_name, "interview_kit");
    assert.equal(result.agentRun.run_status, "failed");
    assert.ok(result.agentRun.error_message);
  });
});

describe("interview kit agent — LLM call error", () => {
  it("produces failed Agent Run when client.complete throws", async () => {
    const client = {
      async complete() { throw new Error("Network timeout"); },
    };
    const result = await runInterviewKit(client, VALID_INPUT);
    assert.equal(result.agentRun.run_status, "failed");
    assert.equal(result.agentRun.status_after, "screened");
    assert.ok(result.agentRun.error_message!.includes("Network timeout"));
    assert.equal(result.commands.length, 1, "Should only have Agent Run on LLM error");
    assert.ok(result.commands[0]!.description.includes("\"Agent Runs\""));
  });

  it("output_json on LLM error is structured failure, not raw input", async () => {
    const client = {
      async complete() { throw new Error("Service unavailable"); },
    };
    const result = await runInterviewKit(client, VALID_INPUT);
    assert.ok(result.agentRun.output_json);
    const output = JSON.parse(result.agentRun.output_json!);
    assert.ok(Array.isArray(output.questions), "output should have questions array");
    assert.ok(!JSON.stringify(output).includes(VALID_INPUT.evaluationSummary),
      "output_json must not contain evaluationSummary");
  });

  it("error_message does not contain full evaluationSummary", async () => {
    const client = {
      async complete() { throw new Error("Failed: " + VALID_INPUT.evaluationSummary); },
    };
    const result = await runInterviewKit(client, VALID_INPUT);
    assert.ok(!result.agentRun.error_message!.includes(VALID_INPUT.evaluationSummary),
      "error_message must not contain evaluationSummary");
  });

  it("error_message does not contain resume fact text", async () => {
    const factText = VALID_INPUT.resumeFacts[0]!.factText;
    const client = {
      async complete() { throw new Error("Failed while using fact: " + factText); },
    };
    const result = await runInterviewKit(client, VALID_INPUT);
    assert.ok(!result.agentRun.error_message!.includes(factText),
      "error_message must not contain resume fact text");
  });
});

describe("interview kit agent — invalid record ID", () => {
  it("throws before calling LLM when candidateRecordId is a business ID", async () => {
    let llmCalled = false;
    const client = {
      async complete() { llmCalled = true; return { content: "{}", promptTemplateId: "x" }; },
    };
    const input: InterviewKitInput = {
      ...VALID_INPUT,
      candidateRecordId: "cand_demo_001",
    };
    await assert.rejects(
      () => runInterviewKit(client, input),
      (err: unknown) => err instanceof Error && err.message.includes("rec_xxx"),
    );
    assert.ok(!llmCalled, "LLM should not be called when candidateRecordId is invalid");
  });

  it("throws before calling LLM when jobRecordId is a business ID", async () => {
    let llmCalled = false;
    const client = {
      async complete() { llmCalled = true; return { content: "{}", promptTemplateId: "x" }; },
    };
    const input: InterviewKitInput = {
      ...VALID_INPUT,
      jobRecordId: "job_demo_001",
    };
    await assert.rejects(
      () => runInterviewKit(client, input),
      (err: unknown) => err instanceof Error && err.message.includes("rec_xxx"),
    );
    assert.ok(!llmCalled, "LLM should not be called when jobRecordId is invalid");
  });
});
