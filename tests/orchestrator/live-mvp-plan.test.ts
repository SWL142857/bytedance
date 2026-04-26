import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildLiveMvpPlan, LiveMvpPlanError } from "../../src/orchestrator/live-mvp-plan.js";
import { DeterministicLlmClient } from "../../src/llm/deterministic-client.js";
import type { ResolvedRecord } from "../../src/base/record-resolution.js";
import { RecordResolutionError } from "../../src/base/record-resolution.js";

const SAMPLE_JOB_RECORD_ID = "rec_demo_job_001";
const SAMPLE_CANDIDATE_RECORD_ID = "rec_demo_candidate_001";

const SAMPLE_RESOLVED: ResolvedRecord[] = [
  { tableName: "jobs", businessField: "job_id", businessId: "job_demo_ai_pm_001", recordId: SAMPLE_JOB_RECORD_ID },
  { tableName: "candidates", businessField: "candidate_id", businessId: "cand_demo_001", recordId: SAMPLE_CANDIDATE_RECORD_ID },
];

const VALID_INPUT = {
  resolvedRecords: SAMPLE_RESOLVED,
  decision: "offer" as const,
  decidedBy: "test_hiring_manager",
  decisionNote: "Test decision note for live MVP plan.",
};

describe("buildLiveMvpPlan — full plan generation", () => {
  it("generates 20 write commands for complete pipeline + decision + report", async () => {
    const result = await buildLiveMvpPlan(VALID_INPUT);
    assert.equal(result.commands.length, 20);
  });

  it("pipeline uses resolved candidateRecordId", async () => {
    const result = await buildLiveMvpPlan(VALID_INPUT);
    assert.equal(result.pipeline.completed, true);
    const statusCmds = result.pipeline.commands.filter((c) => c.description.includes("->"));
    for (const cmd of statusCmds) {
      assert.ok(
        cmd.args.includes(SAMPLE_CANDIDATE_RECORD_ID),
        `Status update must use ${SAMPLE_CANDIDATE_RECORD_ID}`,
      );
    }
  });

  it("pipeline uses resolved jobRecordId for link fields", async () => {
    const result = await buildLiveMvpPlan(VALID_INPUT);
    const evaluationCmds = result.pipeline.commands.filter(
      (c) => c.description.includes("Evaluations"),
    );
    assert.ok(evaluationCmds.length > 0, "Should have evaluation upserts");
    for (const cmd of evaluationCmds) {
      const jsonIdx = cmd.args.indexOf("--json");
      const jsonArg = cmd.args[jsonIdx + 1];
      assert.ok(jsonArg);
      const parsed = JSON.parse(jsonArg!);
      assert.ok(
        JSON.stringify(parsed).includes(SAMPLE_JOB_RECORD_ID),
        "Evaluation job link must use resolved record ID",
      );
    }
  });

  it("decision uses human_confirm actor only", async () => {
    const result = await buildLiveMvpPlan(VALID_INPUT);
    const decisionCmds = result.commands.filter((c) =>
      c.description.includes("decision_pending -> offer"),
    );
    assert.ok(decisionCmds.length >= 1);
    for (const cmd of decisionCmds) {
      assert.ok(cmd.description.includes("human_confirm"));
      assert.ok(!cmd.description.includes("agent"), "Decision must not use agent actor");
    }
  });

  it("decision status matches input", async () => {
    const result = await buildLiveMvpPlan(VALID_INPUT);
    assert.equal(result.finalDecisionStatus, "offer");
  });

  it("rejected decision generates correct plan", async () => {
    const result = await buildLiveMvpPlan({
      ...VALID_INPUT,
      decision: "rejected",
    });
    assert.equal(result.finalDecisionStatus, "rejected");
    const rejectedCmds = result.commands.filter((c) =>
      c.description.includes("decision_pending -> rejected"),
    );
    assert.ok(rejectedCmds.length >= 1);
  });

  it("analytics report is generated", async () => {
    const result = await buildLiveMvpPlan(VALID_INPUT);
    assert.equal(result.reportRunStatus, "success");
    const reportCmds = result.commands.filter((c) =>
      c.description.includes("Reports"),
    );
    assert.ok(reportCmds.length >= 1);
  });

  it("does not call runPlan or execute commands", async () => {
    const result = await buildLiveMvpPlan(VALID_INPUT);
    for (const cmd of result.commands) {
      assert.equal(cmd.command, "lark-cli");
      assert.ok(Array.isArray(cmd.args));
    }
  });
});

describe("buildLiveMvpPlan — pipeline failure fail-closed", () => {
  it("throws before decision/report commands when pipeline does not complete", async () => {
    const failingClient = new DeterministicLlmClient({
      screening_v1: JSON.stringify({ bad: "schema" }),
    });

    await assert.rejects(
      () => buildLiveMvpPlan(VALID_INPUT, failingClient),
      (err: unknown) =>
        err instanceof LiveMvpPlanError &&
        err.message.includes("pipeline stopped at parsed") &&
        err.message.includes("screening"),
    );
  });
});

describe("buildLiveMvpPlan — link fields use rec_xxx not business IDs", () => {
  it("no command args contain job_demo_ or cand_demo_ as link record IDs", async () => {
    const result = await buildLiveMvpPlan(VALID_INPUT);
    for (const cmd of result.commands) {
      const jsonIdx = cmd.args.indexOf("--json");
      if (jsonIdx < 0) continue;
      const jsonArg = cmd.args[jsonIdx + 1];
      if (!jsonArg) continue;
      const parsed = JSON.parse(jsonArg);

      // Check link fields: candidate, job
      for (const field of ["candidate", "job"] as const) {
        if (field in parsed) {
          const val = parsed[field];
          if (Array.isArray(val)) {
            for (const item of val) {
              if (item.id) {
                assert.ok(
                  item.id.startsWith("rec"),
                  `Link field ${field} must use rec_xxx, got ${item.id}`,
                );
              }
            }
          }
        }
      }

      // Check --record-id arg
      const recordIdIdx = cmd.args.indexOf("--record-id");
      if (recordIdIdx >= 0) {
        const recordId = cmd.args[recordIdIdx + 1];
        assert.ok(
          recordId!.startsWith("rec"),
          `--record-id must use rec_xxx, got ${recordId}`,
        );
      }
    }
  });
});

describe("buildLiveMvpPlan — missing/invalid resolution", () => {
  it("throws when job is missing from resolvedRecords", async () => {
    const input = {
      ...VALID_INPUT,
      resolvedRecords: [SAMPLE_RESOLVED[1]!],
    };
    await assert.rejects(
      () => buildLiveMvpPlan(input),
      (err: unknown) => err instanceof RecordResolutionError && err.message.includes("Job"),
    );
  });

  it("throws when candidate is missing from resolvedRecords", async () => {
    const input = {
      ...VALID_INPUT,
      resolvedRecords: [SAMPLE_RESOLVED[0]!],
    };
    await assert.rejects(
      () => buildLiveMvpPlan(input),
      (err: unknown) => err instanceof RecordResolutionError && err.message.includes("Candidate"),
    );
  });

  it("throws when resolved record IDs are invalid", async () => {
    const input = {
      ...VALID_INPUT,
      resolvedRecords: [
        { tableName: "jobs", businessField: "job_id", businessId: "job_demo_ai_pm_001", recordId: "job_demo_ai_pm_001" },
        { tableName: "candidates", businessField: "candidate_id", businessId: "cand_demo_001", recordId: SAMPLE_CANDIDATE_RECORD_ID },
      ],
    };
    await assert.rejects(
      () => buildLiveMvpPlan(input),
      (err: unknown) => err instanceof RecordResolutionError,
    );
  });
});

describe("buildLiveMvpPlan — custom client", () => {
  it("accepts custom LLM client", async () => {
    const client = new DeterministicLlmClient();
    const result = await buildLiveMvpPlan(VALID_INPUT, client);
    assert.equal(result.commands.length, 20);
  });
});
