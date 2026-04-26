import {
  buildMvpReleaseGateReport,
  type MvpReleaseGateInput,
  type MvpReleaseGateReport,
} from "../src/orchestrator/mvp-release-gate.js";

const args = process.argv.slice(2);
const sampleReady = args.includes("--sample-ready");
const sampleNeedsReview = args.includes("--sample-needs-review");
const sampleBlocked = args.includes("--sample-blocked");

function printHeader(label: string, value: string | number | boolean): void {
  console.log(`  ${label}: ${value}`);
}

function printReport(report: MvpReleaseGateReport): void {
  console.log(`=== ${report.title} ===`);
  console.log("");
  printHeader("Status", report.status);
  printHeader("Local Demo Ready", report.localDemoReady);
  printHeader("Live Safety Ready", report.liveSafetyReady);
  printHeader("Real Write Permitted", report.realWritePermittedByReport);
  printHeader("External Model Call Permitted", report.externalModelCallPermittedByReport);

  console.log("");
  console.log("--- Checks ---");
  for (const check of report.checks) {
    console.log(`  [${check.status.toUpperCase()}] ${check.name}: ${check.summary}`);
    console.log(`      Hint: ${check.commandHint}`);
  }

  console.log("");
  console.log("--- Recommended Demo Commands ---");
  for (const cmd of report.recommendedDemoCommands) {
    console.log(`  ${cmd}`);
  }

  console.log("");
  printHeader("Final Handoff Note", report.finalHandoffNote);
  console.log("");
}

function getScenario(): MvpReleaseGateInput {
  if (sampleReady) {
    return {
      typecheckPassed: true,
      testsPassed: true,
      localMvpDemoPassed: true,
      liveReadyDemoPassed: true,
      liveRunbookAvailable: true,
      guardedExecuteBlocksWithoutConfig: true,
      apiBoundaryAuditPassed: true,
      forbiddenTraceScanPassed: true,
    };
  }

  if (sampleNeedsReview) {
    return {
      typecheckPassed: true,
      testsPassed: true,
      localMvpDemoPassed: true,
      liveReadyDemoPassed: false,
      liveRunbookAvailable: false,
      guardedExecuteBlocksWithoutConfig: true,
      apiBoundaryAuditPassed: false,
      forbiddenTraceScanPassed: true,
    };
  }

  if (sampleBlocked) {
    return {
      typecheckPassed: false,
      testsPassed: false,
      localMvpDemoPassed: false,
      liveReadyDemoPassed: false,
      liveRunbookAvailable: false,
      guardedExecuteBlocksWithoutConfig: false,
      apiBoundaryAuditPassed: false,
      forbiddenTraceScanPassed: false,
    };
  }

  return {
    typecheckPassed: true,
    testsPassed: true,
    localMvpDemoPassed: true,
    liveReadyDemoPassed: true,
    liveRunbookAvailable: true,
    guardedExecuteBlocksWithoutConfig: true,
    apiBoundaryAuditPassed: false,
    forbiddenTraceScanPassed: false,
  };
}

function main(): void {
  const input = getScenario();
  const report = buildMvpReleaseGateReport(input);
  printReport(report);
  console.log("Done.");
}

main();
