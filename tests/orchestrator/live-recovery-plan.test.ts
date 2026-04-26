import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildLiveRecoveryPlan,
} from "../../src/orchestrator/live-recovery-plan.js";
import type { LiveMvpExecutionAudit } from "../../src/orchestrator/live-mvp-audit.js";

function buildAudit(
  overrides: Partial<LiveMvpExecutionAudit> = {},
): LiveMvpExecutionAudit {
  return {
    mode: "dry_run",
    blocked: false,
    executed: false,
    totalCommands: 20,
    plannedCount: 20,
    skippedCount: 0,
    successCount: 0,
    failedCount: 0,
    stoppedAtCommandIndex: null,
    stoppedAtDescription: null,
    recoveryNote: "",
    ...overrides,
  };
}

describe("buildLiveRecoveryPlan — dry-run", () => {
  it("returns dry_run_only with risk none and likelyWritten=0", () => {
    const plan = buildLiveRecoveryPlan(
      buildAudit({ mode: "dry_run", blocked: false, plannedCount: 20 }),
    );

    assert.equal(plan.status, "dry_run_only");
    assert.equal(plan.riskLevel, "none");
    assert.equal(plan.likelyWrittenCommandCount, 0);
    assert.equal(plan.completedCommandCount, 0);
    assert.equal(plan.failedCommandIndex, null);
    assert.equal(plan.failedCommandDescription, null);
  });

  it("rerunPolicy mentions readiness", () => {
    const plan = buildLiveRecoveryPlan(buildAudit());
    assert.match(plan.rerunPolicy, /readiness/);
  });
});

describe("buildLiveRecoveryPlan — blocked execute", () => {
  it("returns blocked_before_write with risk low", () => {
    const plan = buildLiveRecoveryPlan(
      buildAudit({
        mode: "execute",
        blocked: true,
        executed: false,
        plannedCount: 0,
        skippedCount: 20,
      }),
    );

    assert.equal(plan.status, "blocked_before_write");
    assert.equal(plan.riskLevel, "low");
    assert.equal(plan.likelyWrittenCommandCount, 0);
    assert.equal(plan.completedCommandCount, 0);
  });

  it("recommendedAction mentions fixing blocked conditions", () => {
    const plan = buildLiveRecoveryPlan(
      buildAudit({ mode: "execute", blocked: true, skippedCount: 20 }),
    );
    assert.match(plan.recommendedAction, /blocked/);
    assert.match(plan.recommendedAction, /readiness/);
  });
});

describe("buildLiveRecoveryPlan — execute all success", () => {
  it("returns completed_successfully with correct counts", () => {
    const plan = buildLiveRecoveryPlan(
      buildAudit({
        mode: "execute",
        blocked: false,
        executed: true,
        plannedCount: 0,
        successCount: 20,
        totalCommands: 20,
      }),
    );

    assert.equal(plan.status, "completed_successfully");
    assert.equal(plan.riskLevel, "low");
    assert.equal(plan.completedCommandCount, 20);
    assert.equal(plan.likelyWrittenCommandCount, 20);
  });

  it("manualChecks includes Agent Runs, Candidates, Reports", () => {
    const plan = buildLiveRecoveryPlan(
      buildAudit({
        mode: "execute",
        blocked: false,
        executed: true,
        plannedCount: 0,
        successCount: 20,
        totalCommands: 20,
      }),
    );

    const checks = plan.manualChecks.join(" ");
    assert.ok(checks.includes("Agent Runs"));
    assert.ok(checks.includes("Candidates"));
    assert.ok(checks.includes("Reports"));
  });
});

describe("buildLiveRecoveryPlan — first command failed", () => {
  it("returns failed_during_write with likelyWritten=0 and failedIndex=1", () => {
    const plan = buildLiveRecoveryPlan(
      buildAudit({
        mode: "execute",
        blocked: false,
        executed: true,
        plannedCount: 0,
        successCount: 0,
        failedCount: 1,
        totalCommands: 20,
        stoppedAtCommandIndex: 1,
        stoppedAtDescription: "Upsert record into Agent Runs",
      }),
    );

    assert.equal(plan.status, "failed_during_write");
    assert.equal(plan.riskLevel, "high");
    assert.equal(plan.likelyWrittenCommandCount, 0);
    assert.equal(plan.completedCommandCount, 1);
    assert.equal(plan.failedCommandIndex, 1);
    assert.equal(plan.failedCommandDescription, "Command 1 failed");
  });
});

describe("buildLiveRecoveryPlan — middle command failed", () => {
  it("returns correct likelyWritten and failedIndex", () => {
    const plan = buildLiveRecoveryPlan(
      buildAudit({
        mode: "execute",
        blocked: false,
        executed: true,
        plannedCount: 0,
        successCount: 7,
        failedCount: 1,
        totalCommands: 20,
        stoppedAtCommandIndex: 8,
        stoppedAtDescription: "Update candidate status: parsed -> screened",
      }),
    );

    assert.equal(plan.status, "failed_during_write");
    assert.equal(plan.riskLevel, "high");
    assert.equal(plan.likelyWrittenCommandCount, 7);
    assert.equal(plan.completedCommandCount, 8);
    assert.equal(plan.failedCommandIndex, 8);
    assert.equal(plan.failedCommandDescription, "Command 8 failed");
  });

  it("rerunPolicy says do NOT re-run full pipeline", () => {
    const plan = buildLiveRecoveryPlan(
      buildAudit({
        mode: "execute",
        blocked: false,
        executed: true,
        plannedCount: 0,
        successCount: 3,
        failedCount: 1,
        totalCommands: 20,
        stoppedAtCommandIndex: 4,
        stoppedAtDescription: "Command 4",
      }),
    );

    assert.match(plan.rerunPolicy, /Do NOT re-run the full pipeline/);
    assert.match(plan.recommendedAction, /Do NOT re-run the full chain/);
  });
});

describe("buildLiveRecoveryPlan — skipped or incomplete", () => {
  it("returns skipped_or_incomplete with risk medium", () => {
    const plan = buildLiveRecoveryPlan(
      buildAudit({
        mode: "execute",
        blocked: false,
        executed: true,
        plannedCount: 0,
        successCount: 18,
        skippedCount: 2,
        failedCount: 0,
        totalCommands: 20,
      }),
    );

    assert.equal(plan.status, "skipped_or_incomplete");
    assert.equal(plan.riskLevel, "medium");
    assert.equal(plan.likelyWrittenCommandCount, 18);
  });

  it("returns skipped_or_incomplete for incomplete without skips", () => {
    const plan = buildLiveRecoveryPlan(
      buildAudit({
        mode: "execute",
        blocked: false,
        executed: true,
        plannedCount: 0,
        successCount: 15,
        skippedCount: 0,
        failedCount: 0,
        totalCommands: 20,
      }),
    );

    assert.equal(plan.status, "skipped_or_incomplete");
    assert.equal(plan.riskLevel, "medium");
  });

  it("recommendedAction mentions investigate skipped reasons", () => {
    const plan = buildLiveRecoveryPlan(
      buildAudit({
        mode: "execute",
        blocked: false,
        executed: true,
        plannedCount: 0,
        successCount: 18,
        skippedCount: 2,
        failedCount: 0,
        totalCommands: 20,
      }),
    );

    assert.match(plan.recommendedAction, /skipped/);
  });
});

describe("buildLiveRecoveryPlan — security", () => {
  it("output strings do not contain token, stdout, payload, or raw stderr", () => {
    const scenarios: Partial<LiveMvpExecutionAudit>[] = [
      { mode: "dry_run", blocked: false, plannedCount: 20 },
      { mode: "execute", blocked: true, skippedCount: 20 },
      {
        mode: "execute",
        blocked: false,
        executed: true,
        plannedCount: 0,
        successCount: 20,
        totalCommands: 20,
      },
      {
        mode: "execute",
        blocked: false,
        executed: true,
        plannedCount: 0,
        successCount: 3,
        failedCount: 1,
        totalCommands: 20,
        stoppedAtCommandIndex: 4,
        stoppedAtDescription: "token stdout payload raw stderr secret command",
      },
      {
        mode: "execute",
        blocked: false,
        executed: true,
        plannedCount: 0,
        successCount: 18,
        skippedCount: 2,
        failedCount: 0,
        totalCommands: 20,
      },
    ];

    for (const overrides of scenarios) {
      const plan = buildLiveRecoveryPlan(buildAudit(overrides));
      const allText = [
        plan.recommendedAction,
        plan.rerunPolicy,
        ...plan.manualChecks,
        plan.failedCommandDescription ?? "",
      ].join(" ");

      assert.doesNotMatch(allText, /token/i, `no token in ${overrides.mode}`);
      assert.doesNotMatch(allText, /stdout/i, `no stdout in ${overrides.mode}`);
      assert.doesNotMatch(allText, /payload/i, `no payload in ${overrides.mode}`);
      assert.doesNotMatch(
        allText,
        /raw stderr/i,
        `no raw stderr in ${overrides.mode}`,
      );
    }
  });
});
