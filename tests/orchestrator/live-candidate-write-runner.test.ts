import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { BaseCommandSpec } from "../../src/base/commands.js";
import type { HireLoopConfig } from "../../src/config.js";
import type { CommandExecutor } from "../../src/base/read-only-runner.js";
import { getLiveLinkRegistry } from "../../src/server/live-link-registry.js";
import {
  generateLiveCandidateWritePlan,
  executeLiveCandidateWrites,
  validateLiveCandidateWriteScope,
  LIVE_CANDIDATE_WRITE_CONFIRM,
} from "../../src/orchestrator/live-candidate-write-runner.js";

const READY_READ_CONFIG: HireLoopConfig = {
  larkAppId: "cli_a_test",
  larkAppSecret: "secret",
  baseAppToken: "base_token",
  feishuBaseWebUrl: null,
  feishuTableWebUrls: {},
  modelApiKey: null,
  modelApiEndpoint: null,
  modelId: null,
  modelProvider: "volcengine-ark",
  allowLarkRead: true,
  allowLarkWrite: false,
  debug: false,
};

function makeReadExecutor(candidateRecordId: string, resumeText: string): CommandExecutor {
  return (_command, args) => {
    const tableIdx = args.indexOf("--table-id");
    const table = tableIdx >= 0 ? args[tableIdx + 1] : "";
    const stdout = table === "Candidates"
      ? JSON.stringify({
          items: [{
            id: candidateRecordId,
            fields: {
              display_name: "Alice Candidate",
              candidate_id: "cand_alice",
              resume_text: resumeText,
              job: [{ id: "rec_job_write_001" }],
            },
          }],
        })
      : JSON.stringify({
          items: [{
            id: "rec_job_write_001",
            fields: {
              title: "AI PM",
              job_id: "job_ai_pm",
              requirements: "5 years PM experience, AI products, data-driven collaboration.",
              rubric: "technical depth, product sense, communication",
            },
          }],
        });
    return { description: "", status: "success", stdout, stderr: null, exitCode: 0, durationMs: 0 };
  };
}

function registerCandidate(recordId: string): string {
  return getLiveLinkRegistry().register("candidates", recordId);
}

describe("live candidate write runner", () => {
  it("generates a planned write plan from read-only live candidate data", async () => {
    const recordId = "rec_write_plan_happy_001";
    const linkId = registerCandidate(recordId);

    const plan = await generateLiveCandidateWritePlan(linkId, {
      loadConfig: () => READY_READ_CONFIG,
      cliAvailable: () => true,
      executor: makeReadExecutor(recordId, "AI PM with six years of product and ML platform experience."),
    });

    assert.equal(plan.status, "planned");
    assert.equal(plan.blockedReasons.length, 0);
    assert.ok(plan.commandCount > 0);
    assert.ok(plan.planNonce.length > 0);
    const targetTables = new Set(plan.commands.map((cmd) => cmd.targetTable));
    assert.deepEqual(
      [...targetTables].sort(),
      ["agent_runs", "candidates", "evaluations", "interview_kits", "resume_facts"].sort(),
    );
    const descriptions = plan.commands.map((cmd) => cmd.description).join("\n");
    assert.ok(!descriptions.includes("-> offer"));
    assert.ok(!descriptions.includes("-> rejected"));
  });

  it("changes planNonce when generated write payload changes", async () => {
    const recordId = "rec_write_plan_nonce_001";
    const linkId = registerCandidate(recordId);
    const deps = {
      loadConfig: () => READY_READ_CONFIG,
      cliAvailable: () => true,
    };

    const first = await generateLiveCandidateWritePlan(linkId, {
      ...deps,
      executor: makeReadExecutor(recordId, "Short AI PM resume."),
    });
    const second = await generateLiveCandidateWritePlan(linkId, {
      ...deps,
      executor: makeReadExecutor(
        recordId,
        "Longer AI PM resume with additional platform leadership and experimentation details.",
      ),
    });

    assert.equal(first.status, "planned");
    assert.equal(second.status, "planned");
    assert.notEqual(first.planNonce, second.planNonce);
  });

  it("rejects known but disallowed write tables", () => {
    const cmd: BaseCommandSpec = {
      description: "Upsert record into \"Reports\"",
      command: "lark-cli",
      args: [
        "base",
        "+record-upsert",
        "--base-token",
        "<BASE_APP_TOKEN>",
        "--table-id",
        "Reports",
        "--json",
        "{}",
      ],
      redactedArgs: [],
      needsBaseToken: true,
      writesRemote: true,
    };

    const errors = validateLiveCandidateWriteScope([cmd]);
    assert.ok(errors.some((error) => error.includes("disallowed table \"reports\"")));
  });

  it("blocks at runner boundary when reviewConfirm is wrong", async () => {
    let readCalled = false;
    const result = await executeLiveCandidateWrites("lnk_live_missing", {
      confirm: LIVE_CANDIDATE_WRITE_CONFIRM,
      reviewConfirm: "wrong",
      planNonce: "abc123",
      deps: {
        loadConfig: () => READY_READ_CONFIG,
        cliAvailable: () => true,
        executor: () => {
          readCalled = true;
          return { description: "", status: "failed", stdout: null, stderr: null, exitCode: 1, durationMs: 0 };
        },
      },
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.executed, false);
    assert.equal(readCalled, false);
  });

  it("blocks on unknown link with correct double confirm", async () => {
    let readCalled = false;
    const result = await executeLiveCandidateWrites("lnk_live_unknown_expired", {
      confirm: LIVE_CANDIDATE_WRITE_CONFIRM,
      reviewConfirm: "REVIEWED_DECISION_PENDING_WRITE_PLAN",
      planNonce: "abc123",
      deps: {
        loadConfig: () => READY_READ_CONFIG,
        cliAvailable: () => true,
        executor: () => {
          readCalled = true;
          return { description: "", status: "failed", stdout: null, stderr: null, exitCode: 1, durationMs: 0 };
        },
      },
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.executed, false);
    assert.equal(readCalled, false, "Executor should not be called for unknown link");
  });

  it("blocks with invalid planNonce on known link", async () => {
    const linkId = registerCandidate("rec_nonce_mismatch");
    const result = await executeLiveCandidateWrites(linkId, {
      confirm: LIVE_CANDIDATE_WRITE_CONFIRM,
      reviewConfirm: "REVIEWED_DECISION_PENDING_WRITE_PLAN",
      planNonce: "ffffffffffffffff",
      deps: {
        loadConfig: () => READY_READ_CONFIG,
        cliAvailable: () => true,
        executor: makeReadExecutor("rec_nonce_mismatch", "Resume text for nonce test."),
      },
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.executed, false);
    assert.ok(result.safeSummary.includes("planNonce"), "Must mention planNonce mismatch");
  });

  it("blocks before read when reviewConfirm is wrong", async () => {
    const linkId = registerCandidate("rec_wrong_review");
    let readCalled = false;
    const result = await executeLiveCandidateWrites(linkId, {
      confirm: LIVE_CANDIDATE_WRITE_CONFIRM,
      reviewConfirm: "wrong_review_confirm",
      planNonce: "abc123",
      deps: {
        loadConfig: () => READY_READ_CONFIG,
        cliAvailable: () => true,
        executor: () => {
          readCalled = true;
          return { description: "", status: "failed", stdout: null, stderr: null, exitCode: 1, durationMs: 0 };
        },
      },
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.executed, false);
    assert.equal(readCalled, false, "Executor should not be called when reviewConfirm is wrong");
  });
});
