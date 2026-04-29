import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildLiveE2eRunbook,
  type LiveE2eRunbookInput,
} from "../../src/orchestrator/live-e2e-runbook.js";

const EMPTY_INPUT: LiveE2eRunbookInput = {
  feishuConfigured: false,
  bootstrapDone: false,
  seedDone: false,
  localUiRunning: false,
  liveRecordsAccessible: false,
  candidateFound: false,
  writePlanGenerated: false,
  writePlanCommandCount: 0,
  writeExecuted: false,
  writeSuccess: false,
  writeFailedCommandIndex: null,
  humanDecisionGenerated: false,
  humanDecisionExecuted: false,
  humanDecisionSuccess: false,
  analyticsReportGenerated: false,
  analyticsReportExecuted: false,
  analyticsReportSuccess: false,
  verificationRun: false,
  verificationPassed: false,
  recoveryRun: false,
  recoveryClean: false,
};

const COMPLETE_INPUT: LiveE2eRunbookInput = {
  feishuConfigured: true,
  bootstrapDone: true,
  seedDone: true,
  localUiRunning: true,
  liveRecordsAccessible: true,
  candidateFound: true,
  writePlanGenerated: true,
  writePlanCommandCount: 20,
  writeExecuted: true,
  writeSuccess: true,
  writeFailedCommandIndex: null,
  humanDecisionGenerated: true,
  humanDecisionExecuted: true,
  humanDecisionSuccess: true,
  analyticsReportGenerated: true,
  analyticsReportExecuted: true,
  analyticsReportSuccess: true,
  verificationRun: true,
  verificationPassed: true,
  recoveryRun: true,
  recoveryClean: true,
};

describe("live e2e runbook", () => {
  it("returns 13 steps in correct order", () => {
    const runbook = buildLiveE2eRunbook(EMPTY_INPUT);
    assert.equal(runbook.steps.length, 13);
    for (let i = 0; i < 13; i++) {
      assert.equal(runbook.steps[i]!.order, i + 1);
    }
  });

  it("has all required fields on every step", () => {
    const runbook = buildLiveE2eRunbook(EMPTY_INPUT);
    for (const step of runbook.steps) {
      assert.ok(step.name.length > 0, `step ${step.order} must have name`);
      assert.ok(step.goal.length > 0, `step ${step.order} must have goal`);
      assert.ok(step.commandHint.length > 0, `step ${step.order} must have commandHint`);
      assert.ok(step.successCriteria.length > 0, `step ${step.order} must have successCriteria`);
      assert.ok(step.failureRecovery.length > 0, `step ${step.order} must have failureRecovery`);
      assert.ok(step.safetyNote.length > 0, `step ${step.order} must have safetyNote`);
      assert.ok(typeof step.rerunnable === "boolean", `step ${step.order} must have rerunnable`);
    }
  });

  it("blocks all steps when feishu is not configured", () => {
    const runbook = buildLiveE2eRunbook(EMPTY_INPUT);
    // Steps 1 is blocked (not configured), steps 2-13 are blocked (dependency)
    for (const step of runbook.steps) {
      assert.equal(step.status, "blocked", `step ${step.order} (${step.name}) should be blocked`);
    }
    assert.equal(runbook.overallStatus, "blocked");
  });

  it("completes all steps when input is fully complete", () => {
    const runbook = buildLiveE2eRunbook(COMPLETE_INPUT);
    for (const step of runbook.steps) {
      assert.ok(
        step.status === "success" || step.status === "ready",
        `step ${step.order} (${step.name}) should be success or ready, got ${step.status}`,
      );
    }
    assert.equal(runbook.overallStatus, "completed");
  });

  it("marks step 1 ready when feishu configured", () => {
    const runbook = buildLiveE2eRunbook({ ...EMPTY_INPUT, feishuConfigured: true });
    assert.equal(runbook.steps[0]!.status, "ready");
    // Step 2 is a safe dry-run; Step 3 is a manual write gate.
    assert.equal(runbook.steps[1]!.status, "ready");
    assert.equal(runbook.steps[2]!.status, "manual");
  });

  it("marks bootstrap execute failed when tables exist but seed is missing", () => {
    const runbook = buildLiveE2eRunbook({
      ...EMPTY_INPUT,
      feishuConfigured: true,
      bootstrapDone: true,
      seedDone: false,
    });

    const step3 = runbook.steps[2]!;
    assert.equal(step3.status, "failed");
    assert.match(step3.failureRecovery, /seed/);
    assert.equal(step3.rerunnable, false);
  });

  it("blocks steps 4+ when bootstrap not done", () => {
    const runbook = buildLiveE2eRunbook({
      ...EMPTY_INPUT,
      feishuConfigured: true,
    });
    assert.equal(runbook.steps[3]!.status, "blocked");
    assert.equal(runbook.steps[4]!.status, "blocked");
  });

  it("marks write step as failed when write fails", () => {
    const runbook = buildLiveE2eRunbook({
      ...EMPTY_INPUT,
      feishuConfigured: true,
      bootstrapDone: true,
      seedDone: true,
      localUiRunning: true,
      liveRecordsAccessible: true,
      candidateFound: true,
      writePlanGenerated: true,
      writePlanCommandCount: 20,
      writeExecuted: true,
      writeSuccess: false,
      writeFailedCommandIndex: 12,
    });
    const step7 = runbook.steps[6]!;
    assert.equal(step7.status, "failed");
    assert.ok(step7.failureRecovery.includes("12"), "should mention failed command index");
  });

  it("blocks analytics steps when human decision not done", () => {
    const runbook = buildLiveE2eRunbook({
      ...EMPTY_INPUT,
      feishuConfigured: true,
      bootstrapDone: true,
      seedDone: true,
      localUiRunning: true,
      liveRecordsAccessible: true,
      candidateFound: true,
      writePlanGenerated: true,
      writePlanCommandCount: 20,
      writeExecuted: true,
      writeSuccess: true,
    });
    assert.equal(runbook.steps[9]!.status, "blocked");
    assert.equal(runbook.steps[10]!.status, "blocked");
  });

  it("marks verification as ready when analytics done", () => {
    const runbook = buildLiveE2eRunbook({
      ...EMPTY_INPUT,
      feishuConfigured: true,
      bootstrapDone: true,
      seedDone: true,
      localUiRunning: true,
      liveRecordsAccessible: true,
      candidateFound: true,
      writePlanGenerated: true,
      writePlanCommandCount: 20,
      writeExecuted: true,
      writeSuccess: true,
      humanDecisionGenerated: true,
      humanDecisionExecuted: true,
      humanDecisionSuccess: true,
      analyticsReportGenerated: true,
      analyticsReportExecuted: true,
      analyticsReportSuccess: true,
    });
    assert.equal(runbook.steps[11]!.status, "ready");
    assert.equal(runbook.steps[12]!.status, "ready");
  });

  it("marks execute gates as manual before non-rerunnable writes run", () => {
    const readyToWrite = buildLiveE2eRunbook({
      ...EMPTY_INPUT,
      feishuConfigured: true,
      bootstrapDone: true,
      seedDone: true,
      localUiRunning: true,
      liveRecordsAccessible: true,
      candidateFound: true,
      writePlanGenerated: true,
      writePlanCommandCount: 20,
    });
    assert.equal(readyToWrite.steps[6]!.status, "manual");

    const readyForHumanDecision = buildLiveE2eRunbook({
      ...EMPTY_INPUT,
      feishuConfigured: true,
      bootstrapDone: true,
      seedDone: true,
      localUiRunning: true,
      liveRecordsAccessible: true,
      candidateFound: true,
      writePlanGenerated: true,
      writePlanCommandCount: 20,
      writeExecuted: true,
      writeSuccess: true,
      humanDecisionGenerated: true,
    });
    assert.equal(readyForHumanDecision.steps[8]!.status, "manual");

    const readyForAnalytics = buildLiveE2eRunbook({
      ...readyForHumanDecisionInput(),
      analyticsReportGenerated: true,
    });
    assert.equal(readyForAnalytics.steps[10]!.status, "manual");
  });

  it("marks verification success when verification passed", () => {
    const runbook = buildLiveE2eRunbook({
      ...COMPLETE_INPUT,
      verificationRun: true,
      verificationPassed: true,
    });
    assert.equal(runbook.steps[11]!.status, "success");
  });

  it("marks verification failed when verification did not pass", () => {
    const runbook = buildLiveE2eRunbook({
      ...COMPLETE_INPUT,
      verificationRun: true,
      verificationPassed: false,
    });
    assert.equal(runbook.steps[11]!.status, "failed");
  });

  it("overall status is in_progress when some steps succeeded", () => {
    const runbook = buildLiveE2eRunbook({
      ...EMPTY_INPUT,
      feishuConfigured: true,
      bootstrapDone: true,
      seedDone: true,
      localUiRunning: true,
      liveRecordsAccessible: true,
    });
    assert.equal(runbook.overallStatus, "in_progress");
  });

  it("overall status is failed when any step failed", () => {
    const runbook = buildLiveE2eRunbook({
      ...EMPTY_INPUT,
      feishuConfigured: true,
      bootstrapDone: true,
      seedDone: true,
      localUiRunning: true,
      liveRecordsAccessible: true,
      candidateFound: true,
      writePlanGenerated: true,
      writePlanCommandCount: 20,
      writeExecuted: true,
      writeSuccess: false,
      writeFailedCommandIndex: 5,
    });
    assert.equal(runbook.overallStatus, "failed");
  });

  it("execute steps are not rerunnable", () => {
    const runbook = buildLiveE2eRunbook(COMPLETE_INPUT);
    const nonRerunnable = runbook.steps.filter((s) => !s.rerunnable);
    // Steps 3, 7, 9, 11 are execute steps
    assert.ok(nonRerunnable.length >= 3, "should have at least 3 non-rerunnable steps");
    for (const step of nonRerunnable) {
      assert.ok(
        step.name.includes("Execute") || step.name.includes("执行") || step.name.includes("Bootstrap Execute"),
        `non-rerunnable step should be an execute step: ${step.name}`,
      );
    }
  });

  it("plan/dry-run/verification steps are rerunnable", () => {
    const runbook = buildLiveE2eRunbook(COMPLETE_INPUT);
    const rerunnable = runbook.steps.filter((s) => s.rerunnable);
    assert.ok(rerunnable.length >= 6, "should have at least 6 rerunnable steps");
  });

  it("runbook has title and description", () => {
    const runbook = buildLiveE2eRunbook(EMPTY_INPUT);
    assert.ok(runbook.title.length > 0);
    assert.ok(runbook.description.length > 0);
    assert.ok(runbook.finalSafetyNote.length > 0);
  });

  it("final safety note mentions no blind rerun", () => {
    const runbook = buildLiveE2eRunbook(EMPTY_INPUT);
    assert.ok(
      runbook.finalSafetyNote.includes("盲目") || runbook.finalSafetyNote.includes("blindly"),
      "final safety note should warn against blind reruns",
    );
  });

  it("runbook text does not include prefilled confirm tokens or raw command args", () => {
    const runbook = buildLiveE2eRunbook(COMPLETE_INPUT);
    const allText = [
      runbook.title,
      runbook.description,
      runbook.finalSafetyNote,
      ...runbook.steps.flatMap((step) => [
        step.name,
        step.goal,
        step.commandHint,
        step.successCriteria,
        step.failureRecovery,
        step.safetyNote,
      ]),
    ].join(" ");

    assert.doesNotMatch(allText, /EXECUTE_/);
    assert.doesNotMatch(allText, /REVIEWED_/);
    assert.doesNotMatch(allText, /--base-token/);
    assert.doesNotMatch(allText, /--json/);
    assert.doesNotMatch(allText, /Body:/);
    assert.doesNotMatch(allText, /\btoken\b/i);
  });

  it("step names cover the full E2E flow", () => {
    const runbook = buildLiveE2eRunbook(EMPTY_INPUT);
    const names = runbook.steps.map((s) => s.name);
    assert.ok(names.some((n) => n.includes("环境") || n.includes("凭据")), "should have env step");
    assert.ok(names.some((n) => n.includes("Bootstrap")), "should have bootstrap steps");
    assert.ok(names.some((n) => n.includes("UI")), "should have UI step");
    assert.ok(names.some((n) => n.includes("Records")), "should have records step");
    assert.ok(names.some((n) => n.includes("写回计划") || n.includes("Write Plan")), "should have write plan step");
    assert.ok(names.some((n) => n.includes("执行") || n.includes("Execute")), "should have execute steps");
    assert.ok(names.some((n) => n.includes("决策")), "should have human decision steps");
    assert.ok(names.some((n) => n.includes("Analytics")), "should have analytics steps");
    assert.ok(names.some((n) => n.includes("验证") || n.includes("Verification")), "should have verification step");
    assert.ok(names.some((n) => n.includes("Recovery")), "should have recovery step");
  });
});

function readyForHumanDecisionInput(): LiveE2eRunbookInput {
  return {
    ...EMPTY_INPUT,
    feishuConfigured: true,
    bootstrapDone: true,
    seedDone: true,
    localUiRunning: true,
    liveRecordsAccessible: true,
    candidateFound: true,
    writePlanGenerated: true,
    writePlanCommandCount: 20,
    writeExecuted: true,
    writeSuccess: true,
    humanDecisionGenerated: true,
    humanDecisionExecuted: true,
    humanDecisionSuccess: true,
  };
}
