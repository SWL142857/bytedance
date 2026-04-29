import {
  buildLiveE2eRunbook,
  type LiveE2eRunbookInput,
  type LiveE2eRunbook,
} from "../src/orchestrator/live-e2e-runbook.js";

const args = process.argv.slice(2);
const sampleFresh = args.includes("--sample-fresh");
const sampleAfterBootstrap = args.includes("--sample-after-bootstrap");
const sampleReadyToWrite = args.includes("--sample-ready-to-write");
const sampleAfterPartialFailure = args.includes("--sample-after-partial-failure");
const sampleComplete = args.includes("--sample-complete");

function printRunbook(runbook: LiveE2eRunbook): void {
  console.log(`=== ${runbook.title} ===`);
  console.log("");
  console.log(runbook.description);
  console.log("");
  console.log(`Overall Status: ${runbook.overallStatus.toUpperCase()}`);
  console.log("");
  console.log("--- Steps ---");
  console.log("");

  for (const step of runbook.steps) {
    const statusLabel = formatStatus(step.status);
    console.log(`  [${step.order}] ${step.name} — ${statusLabel}`);
    console.log(`      目标: ${step.goal}`);
    console.log(`      命令: ${step.commandHint.split("\n")[0]}`);
    console.log(`      成功标准: ${step.successCriteria}`);
    console.log(`      失败恢复: ${step.failureRecovery}`);
    console.log(`      安全说明: ${step.safetyNote}`);
    console.log(`      可重跑: ${step.rerunnable ? "是" : "否"}`);
    console.log("");
  }

  console.log("--- Final Safety Note ---");
  console.log(runbook.finalSafetyNote);
  console.log("");
}

function formatStatus(
  status: "ready" | "blocked" | "manual" | "not_run" | "success" | "failed",
): string {
  switch (status) {
    case "ready":
      return "就绪";
    case "blocked":
      return "阻塞";
    case "manual":
      return "需人工操作";
    case "not_run":
      return "未执行";
    case "success":
      return "成功";
    case "failed":
      return "失败";
  }
}

function getScenario(): LiveE2eRunbookInput {
  if (sampleFresh) {
    return {
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
  }

  if (sampleAfterBootstrap) {
    return {
      feishuConfigured: true,
      bootstrapDone: true,
      seedDone: true,
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
  }

  if (sampleReadyToWrite) {
    return {
      feishuConfigured: true,
      bootstrapDone: true,
      seedDone: true,
      localUiRunning: true,
      liveRecordsAccessible: true,
      candidateFound: true,
      writePlanGenerated: true,
      writePlanCommandCount: 20,
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
  }

  if (sampleAfterPartialFailure) {
    return {
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
  }

  if (sampleComplete) {
    return {
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
  }

  // Default: no args — show all blocked (no env)
  return {
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
}

function main(): void {
  const input = getScenario();
  const runbook = buildLiveE2eRunbook(input);
  printRunbook(runbook);
  console.log("Done.");
}

main();
