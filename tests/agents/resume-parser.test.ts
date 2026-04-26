import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runResumeParser, type ResumeParserInput } from "../../src/agents/resume-parser.js";
import { DeterministicLlmClient } from "../../src/llm/deterministic-client.js";
import type { LlmClient, LlmResponse } from "../../src/llm/client.js";

const VALID_INPUT: ResumeParserInput = {
  candidateRecordId: "recCand001",
  candidateId: "cand_001",
  resumeText: "Test resume with 6 years experience in tech sector.",
  fromStatus: "new",
};

describe("resume parser agent — successful parse", () => {
  it("generates upsert commands for each fact", async () => {
    const client = new DeterministicLlmClient();
    const result = await runResumeParser(client, VALID_INPUT);
    assert.ok(result.commands.length > 0);

    const upsertCmds = result.commands.filter((c) => c.description.includes("Upsert record into \"Resume Facts\""));
    assert.ok(upsertCmds.length >= 2, `Expected >= 2 resume_fact upserts, got ${upsertCmds.length}`);
  });

  it("generates status update new -> parsed", async () => {
    const client = new DeterministicLlmClient();
    const result = await runResumeParser(client, VALID_INPUT);
    const statusCmd = result.commands.find((c) => c.description.includes("new -> parsed"));
    assert.ok(statusCmd, "Missing status update command");
  });

  it("generates Agent Run append", async () => {
    const client = new DeterministicLlmClient();
    const result = await runResumeParser(client, VALID_INPUT);
    assert.equal(result.agentRun.agent_name, "resume_parser");
    assert.equal(result.agentRun.entity_type, "candidate");
    assert.equal(result.agentRun.entity_ref, "cand_001");
    assert.equal(result.agentRun.run_status, "success");
    assert.equal(result.agentRun.status_after, "parsed");
  });

  it("link fields use rec_xxx record IDs", async () => {
    const client = new DeterministicLlmClient();
    const result = await runResumeParser(client, VALID_INPUT);
    const factCmds = result.commands.filter((c) => c.description.includes("\"Resume Facts\""));
    for (const cmd of factCmds) {
      const jsonIdx = cmd.args.indexOf("--json");
      const jsonArg = cmd.args[jsonIdx + 1];
      assert.ok(jsonArg);
      const parsed = JSON.parse(jsonArg!);
      assert.ok(Array.isArray(parsed.candidate), "candidate link should be array");
      assert.ok(parsed.candidate[0].id.startsWith("rec"), "link should use rec_xxx");
    }
  });

  it("commands do not contain full resume text", async () => {
    const client = new DeterministicLlmClient();
    const result = await runResumeParser(client, VALID_INPUT);
    const allJson = result.commands
      .map((c) => { const i = c.args.indexOf("--json"); return i >= 0 ? c.args[i + 1] : ""; })
      .join(" ");
    assert.ok(!allJson.includes(VALID_INPUT.resumeText), "Commands must not contain full resume text");
  });

  it("input_summary does not contain full resume text", async () => {
    const client = new DeterministicLlmClient();
    const result = await runResumeParser(client, VALID_INPUT);
    assert.ok(!result.agentRun.input_summary.includes(VALID_INPUT.resumeText));
    assert.ok(result.agentRun.input_summary.includes("cand_001"));
    assert.ok(result.agentRun.input_summary.includes("resumeLength="));
  });

  it("Agent Run does not contain forbidden keys", async () => {
    const client = new DeterministicLlmClient();
    const result = await runResumeParser(client, VALID_INPUT);
    const forbidden = ["reasoning_chain", "raw_resume", "full_resume", "raw_prompt", "thinking", "chain_of_thought"];
    const runJson = JSON.stringify(result.agentRun);
    for (const key of forbidden) {
      assert.ok(!runJson.includes(key), `Agent Run contains forbidden key: ${key}`);
    }
  });

  it("agent does not execute runPlan — only returns commands", async () => {
    const client = new DeterministicLlmClient();
    const result = await runResumeParser(client, VALID_INPUT);
    for (const cmd of result.commands) {
      assert.equal(cmd.command, "lark-cli");
      assert.ok(Array.isArray(cmd.args));
    }
  });

  it("Agent Run command is first in commands list", async () => {
    const client = new DeterministicLlmClient();
    const result = await runResumeParser(client, VALID_INPUT);
    assert.ok(result.commands.length > 0, "Should have commands");
    assert.ok(result.commands[0]!.description.includes("\"Agent Runs\""), "First command should be Agent Run append");
  });

  it("status update is last business command", async () => {
    const client = new DeterministicLlmClient();
    const result = await runResumeParser(client, VALID_INPUT);
    assert.ok(result.commands.length > 0, "Should have commands");
    const lastCmd = result.commands[result.commands.length - 1];
    assert.ok(lastCmd, "Last command should exist");
    assert.ok(lastCmd!.description.includes("new -> parsed"), "Last command should be status update");
  });
});

describe("resume parser agent — schema validation failure", () => {
  it("retries invalid JSON once and still generates business commands on success", async () => {
    const responses = [
      "not valid json {{{",
      JSON.stringify({
        facts: [{ factType: "skill", factText: "TypeScript", sourceExcerpt: null, confidence: "high" }],
        parseStatus: "success",
      }),
    ];
    const prompts: string[] = [];
    let callIndex = 0;
    const client: LlmClient = {
      async complete(request): Promise<LlmResponse> {
        prompts.push(request.prompt);
        const content = responses[callIndex] ?? responses[responses.length - 1]!;
        callIndex++;
        return { content, promptTemplateId: request.promptTemplateId };
      },
    };

    const result = await runResumeParser(client, VALID_INPUT);

    assert.equal(result.agentRun.run_status, "retried");
    assert.equal(result.agentRun.retry_count, 1);
    assert.equal(callIndex, 2);
    assert.ok(!prompts[1]!.includes(VALID_INPUT.resumeText), "Retry prompt must not include resume text");

    const factCmds = result.commands.filter((c) => c.description.includes("\"Resume Facts\""));
    assert.equal(factCmds.length, 1);
    const statusCmd = result.commands.find((c) => c.description.includes("new -> parsed"));
    assert.ok(statusCmd, "Missing status update command after retry success");
  });

  it("produces failed Agent Run when LLM returns invalid JSON", async () => {
    const client = new DeterministicLlmClient({
      resume_parser_v1: "not valid json {{{",
    });
    const result = await runResumeParser(client, VALID_INPUT);
    assert.equal(result.agentRun.run_status, "failed");
    assert.ok(result.agentRun.error_message);
    assert.ok(result.agentRun.error_message!.includes("JSON") || result.agentRun.error_message!.includes("parse"), `Unexpected error: ${result.agentRun.error_message}`);
  });

  it("produces failed Agent Run when LLM returns schema-invalid output", async () => {
    const client = new DeterministicLlmClient({
      resume_parser_v1: JSON.stringify({ facts: "not_an_array" }),
    });
    const result = await runResumeParser(client, VALID_INPUT);
    assert.equal(result.agentRun.run_status, "failed");
    assert.ok(result.agentRun.error_message);
    assert.equal(result.agentRun.status_after, "new");
  });

  it("does not generate status update when parse fails", async () => {
    const client = new DeterministicLlmClient({
      resume_parser_v1: "bad json",
    });
    const result = await runResumeParser(client, VALID_INPUT);
    const statusCmd = result.commands.find((c) => c.description.includes("new -> parsed"));
    assert.ok(!statusCmd, "Should not generate status update on failure");
  });
});

describe("resume parser agent — LLM call error", () => {
  it("produces failed Agent Run when client.complete throws", async () => {
    const client = {
      async complete() { throw new Error("Network timeout"); },
    };
    const result = await runResumeParser(client, VALID_INPUT);
    assert.equal(result.agentRun.run_status, "failed");
    assert.equal(result.agentRun.status_after, "new");
    assert.ok(result.agentRun.error_message!.includes("Network timeout"));
    assert.equal(result.commands.length, 1, "Should only have Agent Run on LLM error");
    assert.ok(result.commands[0]!.description.includes("\"Agent Runs\""));
  });

  it("output_json on LLM error is structured failure, not raw input", async () => {
    const client = {
      async complete() { throw new Error("Connection refused"); },
    };
    const result = await runResumeParser(client, VALID_INPUT);
    const output = JSON.parse(result.agentRun.output_json!);
    assert.equal(output.parseStatus, "failed");
    assert.ok(Array.isArray(output.facts));
    assert.ok(!JSON.stringify(output).includes(VALID_INPUT.resumeText), "output_json must not contain raw resume");
  });

  it("error_message does not contain full input text", async () => {
    const client = {
      async complete() { throw new Error("Failed for: " + VALID_INPUT.resumeText); },
    };
    const result = await runResumeParser(client, VALID_INPUT);
    assert.ok(!result.agentRun.error_message!.includes(VALID_INPUT.resumeText), "error_message must not contain resume text");
  });
});

describe("resume parser agent — parseStatus=failed from model", () => {
  it("marks run_status as failed when parseStatus is failed", async () => {
    const client = new DeterministicLlmClient({
      resume_parser_v1: JSON.stringify({ facts: [], parseStatus: "failed", errorMessage: "Unreadable resume format" }),
    });
    const result = await runResumeParser(client, VALID_INPUT);
    assert.equal(result.agentRun.run_status, "failed");
    assert.equal(result.agentRun.status_after, "new");
    assert.ok(result.agentRun.error_message!.includes("Unreadable resume format"));
  });

  it("does not generate fact upserts when parseStatus is failed", async () => {
    const client = new DeterministicLlmClient({
      resume_parser_v1: JSON.stringify({ facts: [], parseStatus: "failed" }),
    });
    const result = await runResumeParser(client, VALID_INPUT);
    const factCmds = result.commands.filter((c) => c.description.includes("\"Resume Facts\""));
    assert.equal(factCmds.length, 0, "Should not generate fact upserts on parseStatus=failed");
  });

  it("does not generate status update when parseStatus is failed", async () => {
    const client = new DeterministicLlmClient({
      resume_parser_v1: JSON.stringify({ facts: [], parseStatus: "failed" }),
    });
    const result = await runResumeParser(client, VALID_INPUT);
    const statusCmd = result.commands.find((c) => c.description.includes("new -> parsed"));
    assert.ok(!statusCmd, "Should not generate status update on parseStatus=failed");
  });

  it("uses default error message when model returns no errorMessage", async () => {
    const client = new DeterministicLlmClient({
      resume_parser_v1: JSON.stringify({ facts: [], parseStatus: "failed" }),
    });
    const result = await runResumeParser(client, VALID_INPUT);
    assert.ok(result.agentRun.error_message, "Should have error_message even without model errorMessage");
  });

  it("sanitizes errorMessage when model repeats resume text in parseStatus=failed", async () => {
    const client = new DeterministicLlmClient({
      resume_parser_v1: JSON.stringify({
        facts: [],
        parseStatus: "failed",
        errorMessage: `Could not parse: ${VALID_INPUT.resumeText}`,
      }),
    });
    const result = await runResumeParser(client, VALID_INPUT);
    assert.equal(result.agentRun.run_status, "failed");
    assert.equal(result.agentRun.status_after, "new");
    assert.ok(!result.agentRun.error_message!.includes(VALID_INPUT.resumeText),
      "error_message must not contain full resume text");
    const statusCmd = result.commands.find((c) => c.description.includes("new -> parsed"));
    assert.ok(!statusCmd, "Should not generate status update on parseStatus=failed");
  });
});

describe("resume parser agent — invalid record ID", () => {
  it("throws before calling LLM when candidateRecordId is a business ID", async () => {
    let llmCalled = false;
    const client = {
      async complete() { llmCalled = true; return { content: "{}", promptTemplateId: "x" }; },
    };
    const input: ResumeParserInput = {
      candidateRecordId: "cand_demo_001",
      candidateId: "cand_001",
      resumeText: "test",
      fromStatus: "new",
    };
    await assert.rejects(
      () => runResumeParser(client, input),
      (err: unknown) => err instanceof Error && err.message.includes("rec_xxx"),
    );
    assert.ok(!llmCalled, "LLM should not be called when record ID is invalid");
  });
});
