import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { HireLoopConfig } from "../../src/config.js";
import type { CommandExecutor } from "../../src/base/read-only-runner.js";
import { getLiveLinkRegistry } from "../../src/server/live-link-registry.js";
import type { CandidateStatus } from "../../src/types/state.js";
import type { BaseCommandSpec } from "../../src/base/commands.js";
import {
  generateLiveHumanDecisionPlan,
  executeLiveHumanDecision,
  LIVE_HUMAN_DECISION_CONFIRM,
  REVIEWED_HUMAN_DECISION_PLAN_CONFIRM,
  validateLiveHumanDecisionScope,
} from "../../src/orchestrator/live-human-decision-runner.js";

const READY_CONFIG: HireLoopConfig = {
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
  allowLarkWrite: true,
  debug: false,
};

function makeDecisionExecutor(
  candidateRecordId: string,
  statuses: CandidateStatus[] = ["decision_pending"],
): { executor: CommandExecutor; getWriteCount: () => number } {
  let readCount = 0;
  let writeCount = 0;
  const executor: CommandExecutor = (_command, args) => {
    if (args[1] === "+record-upsert") {
      writeCount += 1;
      return { description: "", status: "success", stdout: "{}", stderr: null, exitCode: 0, durationMs: 0 };
    }

    const status = statuses[Math.min(readCount, statuses.length - 1)] ?? "decision_pending";
    readCount += 1;
    const tableIdx = args.indexOf("--table-id");
    const table = tableIdx >= 0 ? args[tableIdx + 1] : "";
    const stdout = table === "Candidates"
      ? JSON.stringify({
          items: [{
            id: candidateRecordId,
            fields: {
              display_name: "Alice Decision",
              candidate_id: "cand_alice_dec",
              status,
            },
          }],
        })
      : JSON.stringify({ items: [] });
    return { description: "", status: "success", stdout, stderr: null, exitCode: 0, durationMs: 0 };
  };
  return { executor, getWriteCount: () => writeCount };
}

function makeDecisionPendingExecutor(candidateRecordId: string): CommandExecutor {
  return makeDecisionExecutor(candidateRecordId).executor;
}

function registerCandidate(recordId: string): string {
  return getLiveLinkRegistry().register("candidates", recordId);
}

describe("live human decision runner", () => {
  // ── generateLiveHumanDecisionPlan ──

  it("generates a planned decision plan for offer", async () => {
    const recordId = "rec_decision_offer_001";
    const linkId = registerCandidate(recordId);

    const plan = await generateLiveHumanDecisionPlan(linkId, {
      decision: "offer",
      decidedBy: "hiring_manager",
      decisionNote: "Strong technical skills and great culture fit.",
    }, {
      loadConfig: () => READY_CONFIG,
      cliAvailable: () => true,
      executor: makeDecisionPendingExecutor(recordId),
    });

    assert.equal(plan.status, "planned");
    assert.equal(plan.blockedReasons.length, 0);
    assert.equal(plan.decision, "offer");
    assert.equal(plan.commandCount, 2);
    assert.ok(plan.planNonce.length > 0);
    assert.ok(plan.candidateDisplayName);
    const descriptions = plan.commands.map((c) => c.description).join("\n");
    assert.ok(descriptions.includes("offer"), "must mention offer in descriptions");
    assert.ok(descriptions.includes("human_confirm"), "must mention human_confirm actor");
  });

  it("generates a planned decision plan for rejected", async () => {
    const recordId = "rec_decision_reject_001";
    const linkId = registerCandidate(recordId);

    const plan = await generateLiveHumanDecisionPlan(linkId, {
      decision: "rejected",
      decidedBy: "hiring_manager",
      decisionNote: "Lacks required domain experience.",
    }, {
      loadConfig: () => READY_CONFIG,
      cliAvailable: () => true,
      executor: makeDecisionPendingExecutor(recordId),
    });

    assert.equal(plan.status, "planned");
    assert.equal(plan.decision, "rejected");
    assert.equal(plan.commandCount, 2);
    const descriptions = plan.commands.map((c) => c.description).join("\n");
    assert.ok(descriptions.includes("rejected"));
  });

  it("changes planNonce when decision changes", async () => {
    const recordId = "rec_decision_nonce_001";
    const linkId = registerCandidate(recordId);
    const deps = {
      loadConfig: () => READY_CONFIG,
      cliAvailable: () => true,
      executor: makeDecisionPendingExecutor(recordId),
    };

    const offer = await generateLiveHumanDecisionPlan(linkId, {
      decision: "offer",
      decidedBy: "mgr",
      decisionNote: "Great candidate.",
    }, deps);

    const rejected = await generateLiveHumanDecisionPlan(linkId, {
      decision: "rejected",
      decidedBy: "mgr",
      decisionNote: "Not a fit.",
    }, deps);

    assert.equal(offer.status, "planned");
    assert.equal(rejected.status, "planned");
    assert.notEqual(offer.planNonce, rejected.planNonce);
  });

  it("changes planNonce when decision note changes", async () => {
    const recordId = "rec_decision_nonce_note_001";
    const linkId = registerCandidate(recordId);
    const deps = {
      loadConfig: () => READY_CONFIG,
      cliAvailable: () => true,
      executor: makeDecisionPendingExecutor(recordId),
    };

    const first = await generateLiveHumanDecisionPlan(linkId, {
      decision: "offer",
      decidedBy: "mgr",
      decisionNote: "Approved after onsite.",
    }, deps);

    const second = await generateLiveHumanDecisionPlan(linkId, {
      decision: "offer",
      decidedBy: "mgr",
      decisionNote: "Approved after reference check.",
    }, deps);

    assert.equal(first.status, "planned");
    assert.equal(second.status, "planned");
    assert.notEqual(first.planNonce, second.planNonce);
  });

  it("blocks when candidate is not decision_pending", async () => {
    const recordId = "rec_decision_wrong_status_001";
    const linkId = registerCandidate(recordId);

    const plan = await generateLiveHumanDecisionPlan(linkId, {
      decision: "offer",
      decidedBy: "mgr",
      decisionNote: "Good.",
    }, {
      loadConfig: () => READY_CONFIG,
      cliAvailable: () => true,
      executor: makeDecisionExecutor(recordId, ["screened"]).executor,
    });

    assert.equal(plan.status, "blocked");
    assert.ok(plan.safeSummary.includes("decision_pending"));
  });

  it("blocks for unknown link", async () => {
    const plan = await generateLiveHumanDecisionPlan("lnk_live_nonexistent_dec", {
      decision: "offer",
      decidedBy: "mgr",
      decisionNote: "Good.",
    }, {
      loadConfig: () => READY_CONFIG,
      cliAvailable: () => true,
    });

    assert.equal(plan.status, "blocked");
    assert.ok(plan.safeSummary.includes("未找到"));
  });

  it("blocks when buildHumanDecisionPlan rejects invalid input", async () => {
    const recordId = "rec_decision_invalid_001";
    const linkId = registerCandidate(recordId);

    const plan = await generateLiveHumanDecisionPlan(linkId, {
      decision: "offer",
      decidedBy: "",
      decisionNote: "test",
    }, {
      loadConfig: () => READY_CONFIG,
      cliAvailable: () => true,
      executor: makeDecisionPendingExecutor(recordId),
    });

    assert.equal(plan.status, "blocked");
    assert.ok(plan.blockedReasons.length > 0);
  });

  it("validateLiveHumanDecisionScope rejects disallowed table writes", () => {
    const badCommand: BaseCommandSpec = {
      description: "Upsert record into \"Agent Runs\"",
      command: "lark-cli",
      args: [
        "base",
        "+record-upsert",
        "--base-token",
        "<BASE_APP_TOKEN>",
        "--table-id",
        "Agent Runs",
        "--record-id",
        "rec_decision_scope_001",
        "--json",
        "{}",
      ],
      redactedArgs: [],
      needsBaseToken: true,
      writesRemote: true,
    };

    const errors = validateLiveHumanDecisionScope([badCommand], "rec_decision_scope_001", "offer");
    assert.ok(errors.length > 0);
    assert.ok(errors.some((err) => err.includes("非候选人")));
  });

  // ── executeLiveHumanDecision ──

  it("blocks when confirm is wrong", async () => {
    const result = await executeLiveHumanDecision("lnk_live_dec_test", {
      confirm: "wrong",
      reviewConfirm: REVIEWED_HUMAN_DECISION_PLAN_CONFIRM,
      planNonce: "abc123",
      decision: "offer",
      decidedBy: "mgr",
      decisionNote: "test",
    });
    assert.equal(result.status, "blocked");
    assert.equal(result.executed, false);
    assert.ok(result.safeSummary.includes("第一确认"));
  });

  it("blocks when reviewConfirm is wrong", async () => {
    let readCalled = false;
    const result = await executeLiveHumanDecision("lnk_live_dec_test", {
      confirm: LIVE_HUMAN_DECISION_CONFIRM,
      reviewConfirm: "wrong",
      planNonce: "abc123",
      decision: "offer",
      decidedBy: "mgr",
      decisionNote: "test",
      deps: {
        executor: () => {
          readCalled = true;
          return { description: "", status: "failed", stdout: null, stderr: null, exitCode: 1, durationMs: 0 };
        },
      },
    });
    assert.equal(result.status, "blocked");
    assert.equal(result.executed, false);
    assert.equal(readCalled, false, "Must not read when reviewConfirm is wrong");
  });

  it("blocks when planNonce is empty", async () => {
    const result = await executeLiveHumanDecision("lnk_live_dec_test", {
      confirm: LIVE_HUMAN_DECISION_CONFIRM,
      reviewConfirm: REVIEWED_HUMAN_DECISION_PLAN_CONFIRM,
      planNonce: "",
      decision: "offer",
      decidedBy: "mgr",
      decisionNote: "test",
    });
    assert.equal(result.status, "blocked");
    assert.ok(result.safeSummary.includes("planNonce"));
  });

  it("blocks on unknown link with correct double confirm", async () => {
    let readCalled = false;
    const result = await executeLiveHumanDecision("lnk_live_unknown_dec", {
      confirm: LIVE_HUMAN_DECISION_CONFIRM,
      reviewConfirm: REVIEWED_HUMAN_DECISION_PLAN_CONFIRM,
      planNonce: "abc123",
      decision: "offer",
      decidedBy: "mgr",
      decisionNote: "test",
      deps: {
        loadConfig: () => READY_CONFIG,
        cliAvailable: () => true,
        executor: () => {
          readCalled = true;
          return { description: "", status: "failed", stdout: null, stderr: null, exitCode: 1, durationMs: 0 };
        },
      },
    });
    assert.equal(result.status, "blocked");
    assert.equal(result.executed, false);
    assert.equal(readCalled, false, "Must not read for unknown link");
  });

  it("blocks on planNonce mismatch (TOCTOU guard)", async () => {
    const recordId = "rec_decision_toctou_001";
    const linkId = registerCandidate(recordId);

    const result = await executeLiveHumanDecision(linkId, {
      confirm: LIVE_HUMAN_DECISION_CONFIRM,
      reviewConfirm: REVIEWED_HUMAN_DECISION_PLAN_CONFIRM,
      planNonce: "ffffffffffffffff",
      decision: "offer",
      decidedBy: "mgr",
      decisionNote: "test",
      deps: {
        loadConfig: () => READY_CONFIG,
        cliAvailable: () => true,
        executor: makeDecisionPendingExecutor(recordId),
      },
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.executed, false);
    assert.ok(result.safeSummary.includes("planNonce"), "Must mention planNonce mismatch");
  });

  it("executes with injected executor when nonce matches", async () => {
    const recordId = "rec_decision_execute_001";
    const linkId = registerCandidate(recordId);
    const decisionExecutor = makeDecisionExecutor(recordId);
    const deps = {
      loadConfig: () => READY_CONFIG,
      cliAvailable: () => true,
      executor: decisionExecutor.executor,
    };

    const plan = await generateLiveHumanDecisionPlan(linkId, {
      decision: "offer",
      decidedBy: "mgr",
      decisionNote: "Approved.",
    }, deps);
    assert.equal(plan.status, "planned");

    const result = await executeLiveHumanDecision(linkId, {
      confirm: LIVE_HUMAN_DECISION_CONFIRM,
      reviewConfirm: REVIEWED_HUMAN_DECISION_PLAN_CONFIRM,
      planNonce: plan.planNonce,
      decision: "offer",
      decidedBy: "mgr",
      decisionNote: "Approved.",
      deps,
    });

    assert.equal(result.status, "success");
    assert.equal(result.executed, true);
    assert.equal(result.successCount, 2);
    assert.equal(decisionExecutor.getWriteCount(), 2);
  });

  it("blocks execution when candidate status changes after plan generation", async () => {
    const recordId = "rec_decision_status_changed_001";
    const linkId = registerCandidate(recordId);
    const decisionExecutor = makeDecisionExecutor(recordId, ["decision_pending", "offer"]);
    const deps = {
      loadConfig: () => READY_CONFIG,
      cliAvailable: () => true,
      executor: decisionExecutor.executor,
    };

    const plan = await generateLiveHumanDecisionPlan(linkId, {
      decision: "rejected",
      decidedBy: "mgr",
      decisionNote: "Not a fit.",
    }, deps);
    assert.equal(plan.status, "planned");

    const result = await executeLiveHumanDecision(linkId, {
      confirm: LIVE_HUMAN_DECISION_CONFIRM,
      reviewConfirm: REVIEWED_HUMAN_DECISION_PLAN_CONFIRM,
      planNonce: plan.planNonce,
      decision: "rejected",
      decidedBy: "mgr",
      decisionNote: "Not a fit.",
      deps,
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.executed, false);
    assert.equal(decisionExecutor.getWriteCount(), 0);
    assert.ok(result.safeSummary.includes("decision_pending"));
  });

  it("blocks before read when reviewConfirm is wrong", async () => {
    const recordId = "rec_decision_wrong_review_001";
    const linkId = registerCandidate(recordId);
    let readCalled = false;

    const result = await executeLiveHumanDecision(linkId, {
      confirm: LIVE_HUMAN_DECISION_CONFIRM,
      reviewConfirm: "wrong_review",
      planNonce: "abc123",
      decision: "offer",
      decidedBy: "mgr",
      decisionNote: "test",
      deps: {
        executor: () => {
          readCalled = true;
          return { description: "", status: "failed", stdout: null, stderr: null, exitCode: 1, durationMs: 0 };
        },
      },
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.executed, false);
    assert.equal(readCalled, false, "Must not read when reviewConfirm is wrong");
  });
});
