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

describe("candidate pipeline — full success (P3: graph-enhanced flow)", () => {
  it("reaches decision_pending with all 6 executed agents", async () => {
    const client = new DeterministicLlmClient();
    const result = await runCandidatePipeline(client, VALID_INPUT);
    assert.equal(result.finalStatus, "decision_pending");
    assert.equal(result.completed, true);
    assert.equal(result.failedAgent, undefined);
    assert.equal(result.agentRuns.length, 6, "Should have 6 agent runs");
  });

  it("runs agents in correct order: intake → extraction → graph → kit → reviewer → coordinator", async () => {
    const client = new DeterministicLlmClient();
    const result = await runCandidatePipeline(client, VALID_INPUT);
    assert.equal(result.agentRuns[0]!.agent_name, "resume_intake");
    assert.equal(result.agentRuns[1]!.agent_name, "resume_extraction");
    assert.equal(result.agentRuns[2]!.agent_name, "graph_builder");
    assert.equal(result.agentRuns[3]!.agent_name, "interview_kit");
    assert.equal(result.agentRuns[4]!.agent_name, "screening_reviewer");
    assert.equal(result.agentRuns[5]!.agent_name, "hr_coordinator");
  });

  it("has stable status transitions", async () => {
    const client = new DeterministicLlmClient();
    const result = await runCandidatePipeline(client, VALID_INPUT);
    assert.ok(result.commands.length > 0);

    const newToParsed = result.commands.findIndex((c) => c.description.includes("new -> parsed"));
    const parsedToScreened = result.commands.findIndex((c) => c.description.includes("parsed -> screened"));
    const screenedToKit = result.commands.findIndex((c) => c.description.includes("screened -> interview_kit_ready"));
    const kitToDecision = result.commands.findIndex((c) => c.description.includes("interview_kit_ready -> decision_pending"));

    assert.ok(newToParsed >= 0, "Missing new -> parsed (intake)");
    assert.ok(parsedToScreened > newToParsed, "parsed -> screened (extraction) after intake");
    assert.ok(screenedToKit > parsedToScreened, "screened -> interview_kit_ready after extraction");
    assert.ok(kitToDecision > screenedToKit, "kit -> decision_pending (reviewer) after kit");
  });

  it("agentRuns count matches executed agents", async () => {
    const client = new DeterministicLlmClient();
    const result = await runCandidatePipeline(client, VALID_INPUT);
    assert.equal(result.agentRuns.length, 6);
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

  it("does not overwrite candidates.resume_text during agent write commands", async () => {
    const client = new DeterministicLlmClient();
    const result = await runCandidatePipeline(client, {
      ...VALID_INPUT,
      resumeText: "Long resume ".repeat(80),
    });
    const text = JSON.stringify(result.commands);
    assert.ok(!text.includes("\"resume_text\""), "Pipeline commands must not write resume_text");
  });
});

describe("candidate pipeline — early failure stops pipeline (P3)", () => {
  it("stops at extraction failure (intake is deterministic, cannot fail)", async () => {
    const client = new DeterministicLlmClient({
      extraction_v1: "bad json",
    });
    const result = await runCandidatePipeline(client, VALID_INPUT);
    assert.equal(result.finalStatus, "parsed");
    assert.equal(result.completed, false);
    assert.equal(result.failedAgent, "resume_extraction");
    assert.equal(result.agentRuns.length, 2, "Intake + failed extraction");
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
    assert.equal(result.agentRuns.length, 4, "Intake + extraction + graph + failed kit");
  });

  it("stops at graph builder failure", async () => {
    const client = new DeterministicLlmClient({
      graph_builder_v1: "bad json",
    });
    const result = await runCandidatePipeline(client, VALID_INPUT);
    assert.equal(result.finalStatus, "screened");
    assert.equal(result.completed, false);
    assert.equal(result.failedAgent, "graph_builder");
    assert.equal(result.agentRuns.length, 3, "Intake + extraction + failed graph builder");
  });

  it("stops at reviewer failure", async () => {
    const client = new DeterministicLlmClient({
      reviewer_v1: "bad json",
    });
    const result = await runCandidatePipeline(client, VALID_INPUT);
    assert.equal(result.finalStatus, "interview_kit_ready");
    assert.equal(result.completed, false);
    assert.equal(result.failedAgent, "screening_reviewer");
    assert.equal(result.agentRuns.length, 5, "Intake + extraction + graph + kit + failed reviewer");
  });

  it("stops at hr coordinator failure", async () => {
    const client = new DeterministicLlmClient({
      hr_coordinator_v1: "bad json",
    });
    const result = await runCandidatePipeline(client, VALID_INPUT);
    assert.equal(result.finalStatus, "decision_pending");
    assert.equal(result.completed, false);
    assert.equal(result.failedAgent, "hr_coordinator");
    assert.equal(result.agentRuns.length, 6, "All 6 agents run, last one fails");
    assert.equal(result.agentRuns[5]!.run_status, "failed");
  });
});

describe("candidate pipeline — malformed intermediate output_json (P3)", () => {
  it("never throws — returns structured failure when extraction output is bad schema", async () => {
    const client = new DeterministicLlmClient({
      extraction_v1: JSON.stringify({ skills: "not_an_array", features: [], profile: {} }),
    });
    const result = await runCandidatePipeline(client, VALID_INPUT);
    assert.equal(result.completed, false);
    assert.ok(result.failedAgent);
    assert.equal(result.agentRuns.length, 2);
    assert.ok(result.commands.length > 0, "Should still have audit commands");
  });

  it("never throws — returns structured failure when interview kit output is bad schema", async () => {
    const client = new DeterministicLlmClient({
      interview_kit_v1: JSON.stringify({ questions: "not_array", scorecardDimensions: [], focusAreas: [], riskChecks: [] }),
    });
    const result = await runCandidatePipeline(client, VALID_INPUT);
    assert.equal(result.completed, false);
    assert.ok(result.failedAgent);
    assert.equal(result.agentRuns.length, 4);
  });

  it("never throws — returns structured failure when reviewer output is bad schema", async () => {
    const client = new DeterministicLlmClient({
      reviewer_v1: JSON.stringify({ decisionPred: "invalid", confidence: 0.5, reasonLabel: "", reasonGroup: "", reviewSummary: "" }),
    });
    const result = await runCandidatePipeline(client, VALID_INPUT);
    assert.equal(result.completed, false);
    assert.ok(result.failedAgent);
    assert.equal(result.agentRuns.length, 5);
  });
});
