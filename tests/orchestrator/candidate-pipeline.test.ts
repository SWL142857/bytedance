import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runCandidatePipeline, type CandidatePipelineInput } from "../../src/orchestrator/candidate-pipeline.js";
import { DeterministicLlmClient } from "../../src/llm/deterministic-client.js";

const VALID_INPUT: CandidatePipelineInput = {
  candidateRecordId: "recCand001",
  jobRecordId: "recJob001",
  candidateId: "cand_001",
  jobId: "job_001",
  resumeText: "Test resume with 6 years experience in tech sector.",
  jobRequirements: "5+ years in product management",
  jobRubric: "Technical depth, product sense, communication",
};

describe("candidate pipeline — full success", () => {
  it("reaches decision_pending with all 4 agents", async () => {
    const client = new DeterministicLlmClient();
    const result = await runCandidatePipeline(client, VALID_INPUT);
    assert.equal(result.finalStatus, "decision_pending");
    assert.equal(result.completed, true);
    assert.equal(result.failedAgent, undefined);
    assert.equal(result.agentRuns.length, 4, "Should have 4 agent runs");
  });

  it("runs agents in correct order", async () => {
    const client = new DeterministicLlmClient();
    const result = await runCandidatePipeline(client, VALID_INPUT);
    assert.equal(result.agentRuns[0]!.agent_name, "resume_parser");
    assert.equal(result.agentRuns[1]!.agent_name, "screening");
    assert.equal(result.agentRuns[2]!.agent_name, "interview_kit");
    assert.equal(result.agentRuns[3]!.agent_name, "hr_coordinator");
  });

  it("has stable command order with each agent's commands grouped", async () => {
    const client = new DeterministicLlmClient();
    const result = await runCandidatePipeline(client, VALID_INPUT);
    assert.ok(result.commands.length > 0);

    // Find indices of key status transitions
    const newToParsed = result.commands.findIndex((c) => c.description.includes("new -> parsed"));
    const parsedToScreened = result.commands.findIndex((c) => c.description.includes("parsed -> screened"));
    const screenedToKit = result.commands.findIndex((c) => c.description.includes("screened -> interview_kit_ready"));
    const kitToDecision = result.commands.findIndex((c) => c.description.includes("interview_kit_ready -> decision_pending"));

    assert.ok(newToParsed >= 0, "Missing new -> parsed");
    assert.ok(parsedToScreened > newToParsed, "parsed -> screened should come after new -> parsed");
    assert.ok(screenedToKit > parsedToScreened, "screened -> interview_kit_ready should come after parsed -> screened");
    assert.ok(kitToDecision > screenedToKit, "interview_kit_ready -> decision_pending should come last");
  });

  it("agentRuns count matches executed agents", async () => {
    const client = new DeterministicLlmClient();
    const result = await runCandidatePipeline(client, VALID_INPUT);
    assert.equal(result.agentRuns.length, 4);
    for (const run of result.agentRuns) {
      assert.equal(run.run_status, "success");
    }
  });

  it("does not produce offer or rejected", async () => {
    const client = new DeterministicLlmClient();
    const result = await runCandidatePipeline(client, VALID_INPUT);
    const allDescs = result.commands.map((c) => c.description).join(" ");
    assert.ok(!allDescs.includes("-> offer"), "Pipeline should not produce offer");
    assert.ok(!allDescs.includes("-> rejected"), "Pipeline should not produce rejected");
  });
});

describe("candidate pipeline — early failure stops pipeline", () => {
  it("stops at resume parser failure", async () => {
    const client = new DeterministicLlmClient({
      resume_parser_v1: "bad json",
    });
    const result = await runCandidatePipeline(client, VALID_INPUT);
    assert.equal(result.finalStatus, "new");
    assert.equal(result.completed, false);
    assert.equal(result.failedAgent, "resume_parser");
    assert.equal(result.agentRuns.length, 1, "Only parser should run");
  });

  it("stops at screener failure", async () => {
    const client = new DeterministicLlmClient({
      screening_v1: "bad json",
    });
    const result = await runCandidatePipeline(client, VALID_INPUT);
    assert.equal(result.finalStatus, "parsed");
    assert.equal(result.completed, false);
    assert.equal(result.failedAgent, "screening");
    assert.equal(result.agentRuns.length, 2, "Parser + screener should run");
    assert.equal(result.agentRuns[0]!.run_status, "success");
    assert.equal(result.agentRuns[1]!.run_status, "failed");
  });

  it("stops at interview kit failure", async () => {
    const client = new DeterministicLlmClient({
      interview_kit_v1: "bad json",
    });
    const result = await runCandidatePipeline(client, VALID_INPUT);
    assert.equal(result.finalStatus, "screened");
    assert.equal(result.completed, false);
    assert.equal(result.failedAgent, "interview_kit");
    assert.equal(result.agentRuns.length, 3, "Parser + screener + kit should run");
  });

  it("stops at hr coordinator failure", async () => {
    const client = new DeterministicLlmClient({
      hr_coordinator_v1: "bad json",
    });
    const result = await runCandidatePipeline(client, VALID_INPUT);
    assert.equal(result.finalStatus, "interview_kit_ready");
    assert.equal(result.completed, false);
    assert.equal(result.failedAgent, "hr_coordinator");
    assert.equal(result.agentRuns.length, 4, "All agents should run");
    assert.equal(result.agentRuns[3]!.run_status, "failed");
  });
});

describe("candidate pipeline — command order stable", () => {
  it("commands are appended in agent order", async () => {
    const client = new DeterministicLlmClient();
    const result = await runCandidatePipeline(client, VALID_INPUT);

    const parserCmds = result.commands.filter((c) =>
      c.description.includes("\"Resume Facts\"") || c.description.includes("new -> parsed"));
    const screenerCmds = result.commands.filter((c) =>
      c.description.includes("\"Evaluations\"") || c.description.includes("parsed -> screened"));
    const kitCmds = result.commands.filter((c) =>
      c.description.includes("\"Interview Kits\"") || c.description.includes("screened -> interview_kit_ready"));
    const coordCmds = result.commands.filter((c) =>
      c.description.includes("interview_kit_ready -> decision_pending"));

    const lastParserIdx = result.commands.indexOf(parserCmds[parserCmds.length - 1]!);
    const firstScreenerIdx = result.commands.indexOf(screenerCmds[0]!);
    const lastScreenerIdx = result.commands.indexOf(screenerCmds[screenerCmds.length - 1]!);
    const firstKitIdx = result.commands.indexOf(kitCmds[0]!);

    assert.ok(firstScreenerIdx > lastParserIdx, "Screener commands should come after parser commands");
    assert.ok(firstKitIdx > lastScreenerIdx, "Kit commands should come after screener commands");
    assert.ok(coordCmds.length > 0, "Should have coordinator commands");
  });
});

describe("candidate pipeline — malformed intermediate output_json", () => {
  it("never throws — returns structured failure when parser output is bad schema", async () => {
    const client = new DeterministicLlmClient({
      resume_parser_v1: JSON.stringify({ facts: "not_an_array", parseStatus: "success" }),
    });
    const result = await runCandidatePipeline(client, VALID_INPUT);
    assert.equal(result.completed, false);
    assert.ok(result.failedAgent);
    assert.equal(result.agentRuns.length, 1);
    assert.ok(result.commands.length > 0, "Should still have audit commands");
  });

  it("never throws — returns structured failure when screener output is bad schema", async () => {
    const client = new DeterministicLlmClient({
      screening_v1: JSON.stringify({ recommendation: "strong_match", dimensionRatings: "not_array", fairnessFlags: [], talentPoolSignal: null }),
    });
    const result = await runCandidatePipeline(client, VALID_INPUT);
    assert.equal(result.completed, false);
    assert.ok(result.failedAgent);
    assert.equal(result.agentRuns.length, 2);
  });

  it("never throws — returns structured failure when interview kit output is bad schema", async () => {
    const client = new DeterministicLlmClient({
      interview_kit_v1: JSON.stringify({ questions: "not_array", scorecardDimensions: [], focusAreas: [], riskChecks: [] }),
    });
    const result = await runCandidatePipeline(client, VALID_INPUT);
    assert.equal(result.completed, false);
    assert.ok(result.failedAgent);
    assert.equal(result.agentRuns.length, 3);
  });
});
