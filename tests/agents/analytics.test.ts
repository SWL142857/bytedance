import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runAnalytics, type AnalyticsInput } from "../../src/agents/analytics.js";
import { DeterministicLlmClient } from "../../src/llm/deterministic-client.js";

const VALID_INPUT: AnalyticsInput = {
  reportId: "rpt_2026_w17",
  periodStart: "2026-04-19 00:00:00",
  periodEnd: "2026-04-25 23:59:59",
  candidates: [
    { candidateId: "cand_001", status: "decision_pending", screeningRecommendation: "strong_match", talentPoolCandidate: false },
    { candidateId: "cand_002", status: "screened", screeningRecommendation: "review_needed", talentPoolCandidate: true },
    { candidateId: "cand_003", status: "parsed", screeningRecommendation: null, talentPoolCandidate: false },
    { candidateId: "cand_004", status: "new", screeningRecommendation: null, talentPoolCandidate: false },
  ],
  evaluations: [
    { candidateId: "cand_001", dimension: "technical_depth", rating: "strong", recommendation: "strong_match", fairnessFlags: [], talentPoolSignal: null },
    { candidateId: "cand_001", dimension: "product_sense", rating: "strong", recommendation: "strong_match", fairnessFlags: [], talentPoolSignal: null },
  ],
  agentRuns: [
    { agentName: "resume_parser", runStatus: "success" },
    { agentName: "screening", runStatus: "success" },
    { agentName: "interview_kit", runStatus: "success" },
    { agentName: "hr_coordinator", runStatus: "success" },
    { agentName: "resume_parser", runStatus: "failed" },
  ],
};

describe("analytics agent — successful report", () => {
  it("generates Reports upsert command", async () => {
    const client = new DeterministicLlmClient();
    const result = await runAnalytics(client, VALID_INPUT);
    const reportCmd = result.commands.find((c) => c.description.includes("\"Reports\""));
    assert.ok(reportCmd, "Missing Reports upsert command");
  });

  it("Agent Run command is first in commands list", async () => {
    const client = new DeterministicLlmClient();
    const result = await runAnalytics(client, VALID_INPUT);
    assert.ok(result.commands.length > 0);
    assert.ok(result.commands[0]!.description.includes("\"Agent Runs\""), "First command should be Agent Run append");
  });

  it("Report upsert is second command", async () => {
    const client = new DeterministicLlmClient();
    const result = await runAnalytics(client, VALID_INPUT);
    assert.ok(result.commands.length >= 2);
    assert.ok(result.commands[1]!.description.includes("\"Reports\""), "Second command should be Report upsert");
  });

  it("report payload contains required fields", async () => {
    const client = new DeterministicLlmClient();
    const result = await runAnalytics(client, VALID_INPUT);
    const reportCmd = result.commands.find((c) => c.description.includes("\"Reports\""));
    assert.ok(reportCmd);
    const jsonIdx = reportCmd!.args.indexOf("--json");
    const jsonArg = reportCmd!.args[jsonIdx + 1];
    assert.ok(jsonArg);
    const parsed = JSON.parse(jsonArg!);
    assert.equal(parsed.report_id, "rpt_2026_w17");
    assert.equal(parsed.period_start, VALID_INPUT.periodStart);
    assert.equal(parsed.period_end, VALID_INPUT.periodEnd);
    assert.ok(parsed.funnel_summary, "Missing funnel_summary");
    assert.ok(parsed.quality_summary, "Missing quality_summary");
    assert.equal(parsed.created_by_agent, "analytics");
  });

  it("bottlenecks are joined with newline", async () => {
    const client = new DeterministicLlmClient();
    const result = await runAnalytics(client, VALID_INPUT);
    const reportCmd = result.commands.find((c) => c.description.includes("\"Reports\""));
    const jsonIdx = reportCmd!.args.indexOf("--json");
    const parsed = JSON.parse(reportCmd!.args[jsonIdx + 1]!);
    assert.ok(typeof parsed.bottlenecks === "string");
    assert.ok(parsed.bottlenecks.includes("\n"), "bottlenecks should contain newlines");
  });

  it("talent_pool_suggestions are joined with newline", async () => {
    const client = new DeterministicLlmClient();
    const result = await runAnalytics(client, VALID_INPUT);
    const reportCmd = result.commands.find((c) => c.description.includes("\"Reports\""));
    const jsonIdx = reportCmd!.args.indexOf("--json");
    const parsed = JSON.parse(reportCmd!.args[jsonIdx + 1]!);
    assert.ok(typeof parsed.talent_pool_suggestions === "string");
    assert.ok(parsed.talent_pool_suggestions.includes("\n"));
  });

  it("recommendations are joined with newline", async () => {
    const client = new DeterministicLlmClient();
    const result = await runAnalytics(client, VALID_INPUT);
    const reportCmd = result.commands.find((c) => c.description.includes("\"Reports\""));
    const jsonIdx = reportCmd!.args.indexOf("--json");
    const parsed = JSON.parse(reportCmd!.args[jsonIdx + 1]!);
    assert.ok(typeof parsed.recommendations === "string");
    assert.ok(parsed.recommendations.includes("\n"));
  });

  it("does not produce Candidates update commands", async () => {
    const client = new DeterministicLlmClient();
    const result = await runAnalytics(client, VALID_INPUT);
    const candCmd = result.commands.find((c) => c.description.includes("\"Candidates\""));
    assert.ok(!candCmd, "Analytics should not update Candidates");
  });

  it("does not produce offer or rejected status transitions", async () => {
    const client = new DeterministicLlmClient();
    const result = await runAnalytics(client, VALID_INPUT);
    const allDescs = result.commands.map((c) => c.description).join(" ");
    assert.ok(!allDescs.includes("-> offer"), "Should not produce offer");
    assert.ok(!allDescs.includes("-> rejected"), "Should not produce rejected");
  });

  it("generates Agent Run with correct metadata", async () => {
    const client = new DeterministicLlmClient();
    const result = await runAnalytics(client, VALID_INPUT);
    assert.equal(result.agentRun.agent_name, "analytics");
    assert.equal(result.agentRun.entity_type, "report");
    assert.equal(result.agentRun.entity_ref, "rpt_2026_w17");
    assert.equal(result.agentRun.run_status, "success");
  });

  it("Agent Run does not have status_before or status_after", async () => {
    const client = new DeterministicLlmClient();
    const result = await runAnalytics(client, VALID_INPUT);
    assert.equal(result.agentRun.status_before, undefined);
    assert.equal(result.agentRun.status_after, undefined);
  });

  it("input_summary contains aggregate data, not candidate details", async () => {
    const client = new DeterministicLlmClient();
    const result = await runAnalytics(client, VALID_INPUT);
    assert.ok(!result.agentRun.input_summary.includes("cand_001"), "Should not contain individual candidate IDs");
    assert.ok(result.agentRun.input_summary.includes("candidates=4"), "Should contain candidate count");
    assert.ok(result.agentRun.input_summary.includes("evaluations=2"), "Should contain evaluation count");
    assert.ok(result.agentRun.input_summary.includes("agentRuns=5"), "Should contain agent run count");
  });

  it("output_json does not contain forbidden keys", async () => {
    const client = new DeterministicLlmClient();
    const result = await runAnalytics(client, VALID_INPUT);
    const forbidden = ["reasoning_chain", "raw_resume", "full_resume", "raw_prompt", "thinking", "chain_of_thought"];
    const runJson = JSON.stringify(result.agentRun);
    for (const key of forbidden) {
      assert.ok(!runJson.includes(key), `Agent Run contains forbidden key: ${key}`);
    }
  });

  it("agent does not execute runPlan — only returns commands", async () => {
    const client = new DeterministicLlmClient();
    const result = await runAnalytics(client, VALID_INPUT);
    for (const cmd of result.commands) {
      assert.equal(cmd.command, "lark-cli");
      assert.ok(Array.isArray(cmd.args));
    }
  });
});

describe("analytics agent — schema validation failure", () => {
  it("produces failed Agent Run when LLM returns invalid JSON", async () => {
    const client = new DeterministicLlmClient({
      analytics_v1: "not valid json {{{",
    });
    const result = await runAnalytics(client, VALID_INPUT);
    assert.equal(result.agentRun.run_status, "failed");
    assert.ok(result.agentRun.error_message);
    assert.ok(result.agentRun.error_message!.includes("JSON") || result.agentRun.error_message!.includes("parse"),
      `Unexpected error: ${result.agentRun.error_message}`);
  });

  it("produces failed Agent Run when LLM returns schema-invalid output", async () => {
    const client = new DeterministicLlmClient({
      analytics_v1: JSON.stringify({ funnelSummary: 123, qualitySummary: "ok" }),
    });
    const result = await runAnalytics(client, VALID_INPUT);
    assert.equal(result.agentRun.run_status, "failed");
    assert.ok(result.agentRun.error_message);
  });

  it("rejects forbidden keys in output", async () => {
    const client = new DeterministicLlmClient({
      analytics_v1: JSON.stringify({
        funnelSummary: "ok",
        qualitySummary: "ok",
        bottlenecks: [],
        talentPoolSuggestions: [],
        recommendations: [],
        thinking: "secret",
      }),
    });
    const result = await runAnalytics(client, VALID_INPUT);
    assert.equal(result.agentRun.run_status, "failed");
    assert.ok(result.agentRun.error_message!.includes("Forbidden"));
  });

  it("does not generate Report upsert on failure", async () => {
    const client = new DeterministicLlmClient({
      analytics_v1: "bad json",
    });
    const result = await runAnalytics(client, VALID_INPUT);
    const reportCmd = result.commands.find((c) => c.description.includes("\"Reports\""));
    assert.ok(!reportCmd, "Should not generate Report on failure");
  });

  it("still generates Agent Run on failure", async () => {
    const client = new DeterministicLlmClient({
      analytics_v1: "bad json",
    });
    const result = await runAnalytics(client, VALID_INPUT);
    assert.equal(result.agentRun.agent_name, "analytics");
    assert.equal(result.agentRun.run_status, "failed");
    assert.ok(result.agentRun.error_message);
  });
});

describe("analytics agent — LLM call error", () => {
  it("produces failed Agent Run when client.complete throws", async () => {
    const client = {
      async complete() { throw new Error("Network timeout"); },
    };
    const result = await runAnalytics(client, VALID_INPUT);
    assert.equal(result.agentRun.run_status, "failed");
    assert.ok(result.agentRun.error_message!.includes("Network timeout"));
    assert.equal(result.commands.length, 1, "Should only have Agent Run on LLM error");
    assert.ok(result.commands[0]!.description.includes("\"Agent Runs\""));
  });
});
