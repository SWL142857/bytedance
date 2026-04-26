import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildLiveOperatorRunbook,
  type LiveOperatorRunbookInput,
} from "../../src/orchestrator/live-operator-runbook.js";

function buildInput(
  overrides: Partial<LiveOperatorRunbookInput> = {},
): LiveOperatorRunbookInput {
  return {
    readinessReady: false,
    safeToExecuteLiveWrites: false,
    dryRunCommandCount: 0,
    verificationStatus: "not_run",
    recoveryStatus: "dry_run_only",
    ...overrides,
  };
}

describe("buildLiveOperatorRunbook - ready for human execution", () => {
  it("returns true when readiness + safe + dryRun > 0", () => {
    const runbook = buildLiveOperatorRunbook(
      buildInput({
        readinessReady: true,
        safeToExecuteLiveWrites: true,
        dryRunCommandCount: 20,
      }),
    );

    assert.equal(runbook.readyForHumanExecution, true);
    assert.equal(runbook.liveWriteAllowedByReport, true);
  });

  it("execute step is ready", () => {
    const runbook = buildLiveOperatorRunbook(
      buildInput({
        readinessReady: true,
        safeToExecuteLiveWrites: true,
        dryRunCommandCount: 20,
      }),
    );

    const execute = runbook.steps.find((s) => s.name === "Guarded Live Execute")!;
    assert.equal(execute.status, "ready");
  });
});

describe("buildLiveOperatorRunbook - live write report flag", () => {
  it("reflects safeToExecuteLiveWrites independent of dry-run command count", () => {
    const runbook = buildLiveOperatorRunbook(
      buildInput({
        readinessReady: true,
        safeToExecuteLiveWrites: true,
        dryRunCommandCount: 0,
      }),
    );

    assert.equal(runbook.readyForHumanExecution, false);
    assert.equal(runbook.liveWriteAllowedByReport, true);
  });
});

describe("buildLiveOperatorRunbook - readiness blocked", () => {
  it("returns false for readyForHumanExecution", () => {
    const runbook = buildLiveOperatorRunbook(
      buildInput({
        readinessReady: false,
        safeToExecuteLiveWrites: false,
        dryRunCommandCount: 0,
      }),
    );

    assert.equal(runbook.readyForHumanExecution, false);
  });

  it("execute step is blocked", () => {
    const runbook = buildLiveOperatorRunbook(
      buildInput({ readinessReady: false }),
    );

    const execute = runbook.steps.find((s) => s.name === "Guarded Live Execute")!;
    assert.equal(execute.status, "blocked");
  });

  it("readiness step is blocked", () => {
    const runbook = buildLiveOperatorRunbook(
      buildInput({ readinessReady: false }),
    );

    const readiness = runbook.steps.find((s) => s.name === "Readiness Review")!;
    assert.equal(readiness.status, "blocked");
  });
});

describe("buildLiveOperatorRunbook - dryRunCommandCount=0", () => {
  it("dry-run step is blocked", () => {
    const runbook = buildLiveOperatorRunbook(
      buildInput({ dryRunCommandCount: 0 }),
    );

    const dryRun = runbook.steps.find((s) => s.name === "Dry-run Write Plan Review")!;
    assert.equal(dryRun.status, "blocked");
    assert.match(dryRun.summary, /0 commands/);
  });
});

describe("buildLiveOperatorRunbook - human approval gate", () => {
  it("is always manual", () => {
    const scenarios: Partial<LiveOperatorRunbookInput>[] = [
      { readinessReady: true, safeToExecuteLiveWrites: true, dryRunCommandCount: 20 },
      { readinessReady: false },
    ];

    for (const overrides of scenarios) {
      const runbook = buildLiveOperatorRunbook(buildInput(overrides));
      const gate = runbook.steps.find((s) => s.name === "Human Approval Gate")!;
      assert.equal(gate.status, "manual");
      assert.equal(gate.order, 3);
    }
  });

  it("manualApprovalRequired is always true", () => {
    const runbook = buildLiveOperatorRunbook(
      buildInput({
        readinessReady: true,
        safeToExecuteLiveWrites: true,
        dryRunCommandCount: 20,
      }),
    );

    assert.equal(runbook.manualApprovalRequired, true);
  });
});

describe("buildLiveOperatorRunbook - post-write verification", () => {
  it("passed verification shows ready", () => {
    const runbook = buildLiveOperatorRunbook(
      buildInput({
        verificationStatus: "passed",
        recoveryStatus: "completed_successfully",
      }),
    );

    const verify = runbook.steps.find((s) => s.name === "Post-write Verification")!;
    assert.equal(verify.status, "ready");
    assert.match(verify.summary, /passed/);
  });

  it("failed verification shows blocked", () => {
    const runbook = buildLiveOperatorRunbook(
      buildInput({ verificationStatus: "failed" }),
    );

    const verify = runbook.steps.find((s) => s.name === "Post-write Verification")!;
    assert.equal(verify.status, "blocked");
  });

  it("needs_review verification shows manual", () => {
    const runbook = buildLiveOperatorRunbook(
      buildInput({ verificationStatus: "needs_review" }),
    );

    const verify = runbook.steps.find((s) => s.name === "Post-write Verification")!;
    assert.equal(verify.status, "manual");
  });

  it("not_run verification shows not_run", () => {
    const runbook = buildLiveOperatorRunbook(
      buildInput({ verificationStatus: "not_run" }),
    );

    const verify = runbook.steps.find((s) => s.name === "Post-write Verification")!;
    assert.equal(verify.status, "not_run");
  });
});

describe("buildLiveOperatorRunbook - recovery review", () => {
  it("failed_during_write warns not to re-run full pipeline", () => {
    const runbook = buildLiveOperatorRunbook(
      buildInput({ recoveryStatus: "failed_during_write" }),
    );

    const recovery = runbook.steps.find((s) => s.name === "Recovery Review")!;
    assert.equal(recovery.status, "blocked");
    assert.match(recovery.summary, /Do NOT re-run the full pipeline/);
  });

  it("completed_successfully shows ready", () => {
    const runbook = buildLiveOperatorRunbook(
      buildInput({ recoveryStatus: "completed_successfully" }),
    );

    const recovery = runbook.steps.find((s) => s.name === "Recovery Review")!;
    assert.equal(recovery.status, "ready");
  });
});

describe("buildLiveOperatorRunbook - step ordering", () => {
  it("has exactly 6 steps in correct order", () => {
    const runbook = buildLiveOperatorRunbook(buildInput());

    assert.equal(runbook.steps.length, 6);
    assert.equal(runbook.steps[0]!.name, "Readiness Review");
    assert.equal(runbook.steps[1]!.name, "Dry-run Write Plan Review");
    assert.equal(runbook.steps[2]!.name, "Human Approval Gate");
    assert.equal(runbook.steps[3]!.name, "Guarded Live Execute");
    assert.equal(runbook.steps[4]!.name, "Recovery Review");
    assert.equal(runbook.steps[5]!.name, "Post-write Verification");
  });
});

describe("buildLiveOperatorRunbook - security", () => {
  it("finalSafetyNote and summaries do not contain token, stdout, payload, raw stderr", () => {
    const scenarios: Partial<LiveOperatorRunbookInput>[] = [
      {
        readinessReady: true,
        safeToExecuteLiveWrites: true,
        dryRunCommandCount: 20,
        verificationStatus: "passed",
        recoveryStatus: "completed_successfully",
      },
      {
        readinessReady: false,
        safeToExecuteLiveWrites: false,
        dryRunCommandCount: 0,
        verificationStatus: "not_run",
        recoveryStatus: "dry_run_only",
      },
      {
        readinessReady: true,
        safeToExecuteLiveWrites: true,
        dryRunCommandCount: 20,
        verificationStatus: "failed",
        recoveryStatus: "failed_during_write",
      },
    ];

    for (const overrides of scenarios) {
      const runbook = buildLiveOperatorRunbook(buildInput(overrides));
      const allText = [
        runbook.finalSafetyNote,
        ...runbook.steps.map((s) => s.summary),
      ].join(" ");

      assert.doesNotMatch(allText, /token/i, `no token`);
      assert.doesNotMatch(allText, /stdout/i, `no stdout`);
      assert.doesNotMatch(allText, /payload/i, `no payload`);
      assert.doesNotMatch(allText, /raw stderr/i, `no raw stderr`);
    }
  });

  it("commandHints do not contain raw args or --base-token or --json", () => {
    const runbook = buildLiveOperatorRunbook(
      buildInput({
        readinessReady: true,
        safeToExecuteLiveWrites: true,
        dryRunCommandCount: 20,
      }),
    );

    for (const step of runbook.steps) {
      assert.ok(!step.commandHint.includes("--base-token"), `${step.name}: no --base-token`);
      assert.ok(!step.commandHint.includes("--json"), `${step.name}: no --json`);
    }
  });
});
