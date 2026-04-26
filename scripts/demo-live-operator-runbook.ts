import {
  buildLiveOperatorRunbook,
  type LiveOperatorRunbookInput,
  type LiveOperatorRunbook,
} from "../src/orchestrator/live-operator-runbook.js";

const args = process.argv.slice(2);
const sampleReady = args.includes("--sample-ready");
const sampleBlocked = args.includes("--sample-blocked");
const sampleAfterSuccess = args.includes("--sample-after-success");
const sampleAfterFailure = args.includes("--sample-after-failure");

function printHeader(label: string, value: string | number | boolean): void {
  console.log(`  ${label}: ${value}`);
}

function printRunbook(runbook: LiveOperatorRunbook): void {
  console.log(`=== ${runbook.title} ===`);
  console.log("");
  printHeader("Ready for Human Execution", runbook.readyForHumanExecution);
  printHeader("Live Write Allowed by Report", runbook.liveWriteAllowedByReport);
  printHeader("Manual Approval Required", runbook.manualApprovalRequired);

  console.log("");
  console.log("--- Steps ---");
  for (const step of runbook.steps) {
    console.log(
      `  [${step.order}] ${step.name} (${step.status.toUpperCase()}): ${step.summary}`,
    );
    console.log(`      Hint: ${step.commandHint}`);
  }

  console.log("");
  printHeader("Final Safety Note", runbook.finalSafetyNote);
  console.log("");
}

function getScenario(): LiveOperatorRunbookInput {
  if (sampleReady) {
    return {
      readinessReady: true,
      safeToExecuteLiveWrites: true,
      dryRunCommandCount: 20,
      verificationStatus: "not_run",
      recoveryStatus: "dry_run_only",
    };
  }

  if (sampleBlocked) {
    return {
      readinessReady: false,
      safeToExecuteLiveWrites: false,
      dryRunCommandCount: 0,
      verificationStatus: "not_run",
      recoveryStatus: "blocked_before_write",
    };
  }

  if (sampleAfterSuccess) {
    return {
      readinessReady: true,
      safeToExecuteLiveWrites: true,
      dryRunCommandCount: 20,
      verificationStatus: "passed",
      recoveryStatus: "completed_successfully",
    };
  }

  if (sampleAfterFailure) {
    return {
      readinessReady: true,
      safeToExecuteLiveWrites: true,
      dryRunCommandCount: 20,
      verificationStatus: "failed",
      recoveryStatus: "failed_during_write",
    };
  }

  return {
    readinessReady: false,
    safeToExecuteLiveWrites: false,
    dryRunCommandCount: 20,
    verificationStatus: "not_run",
    recoveryStatus: "dry_run_only",
  };
}

function main(): void {
  const input = getScenario();
  const runbook = buildLiveOperatorRunbook(input);
  printRunbook(runbook);
  console.log("Done.");
}

main();
