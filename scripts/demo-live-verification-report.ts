import {
  buildLiveVerificationReport,
  type LiveVerificationReport,
} from "../src/orchestrator/live-verification-report.js";

const args = process.argv.slice(2);
const showSamplePassed = args.includes("--sample-passed");
const showSampleFailed = args.includes("--sample-failed");

function printHeader(label: string, value: string | number | boolean | null): void {
  console.log(`  ${label}: ${value}`);
}

function printReport(report: LiveVerificationReport): void {
  printHeader("Mode", report.mode);
  printHeader("Status", report.status);
  printHeader("Expected Write Count", report.expectedWriteCount);
  printHeader("Verified Check Count", report.verifiedCheckCount);
  printHeader("Manual Review Required", report.manualReviewRequired);

  console.log("");
  console.log("--- Checks ---");
  for (const check of report.checks) {
    console.log(`  [${check.status.toUpperCase()}] ${check.name}: ${check.summary}`);
  }

  console.log("");
  printHeader("Next Step", report.nextStep);
}

function main(): void {
  console.log("=== Live Verification Report Demo ===");
  console.log("");

  if (showSamplePassed) {
    console.log("--- Scenario: Readonly All Passed ---");
    const report = buildLiveVerificationReport({
      mode: "readonly",
      expectedWriteCount: 20,
      agentRunsVerified: true,
      candidateStatusVerified: true,
      reportsVerified: true,
      resumeFactsVerified: true,
      evaluationsVerified: true,
      interviewKitsVerified: true,
    });
    printReport(report);
  } else if (showSampleFailed) {
    console.log("--- Scenario: Readonly Partial Failure ---");
    const report = buildLiveVerificationReport({
      mode: "readonly",
      expectedWriteCount: 20,
      agentRunsVerified: true,
      candidateStatusVerified: false,
      reportsVerified: null,
      resumeFactsVerified: true,
      evaluationsVerified: true,
      interviewKitsVerified: true,
    });
    printReport(report);
  } else {
    console.log("--- Scenario: Sample (Default) ---");
    const report = buildLiveVerificationReport({
      mode: "sample",
      expectedWriteCount: 20,
      agentRunsVerified: null,
      candidateStatusVerified: null,
      reportsVerified: null,
    });
    printReport(report);
  }

  console.log("");
  console.log("Done.");
}

main();
