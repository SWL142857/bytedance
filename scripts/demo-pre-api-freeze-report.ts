import {
  buildPreApiFreezeReport,
  type PreApiFreezeInput,
  type PreApiFreezeCheckStatus,
} from "../src/orchestrator/pre-api-freeze-report.js";

const args = process.argv.slice(2);
const sampleFrozen = args.includes("--sample-frozen");
const sampleNeedsReview = args.includes("--sample-needs-review");
const sampleBlocked = args.includes("--sample-blocked");

function printHeader(label: string, value: string | number | boolean): void {
  console.log(`  ${label}: ${value}`);
}

function statusTag(status: PreApiFreezeCheckStatus): string {
  return status === "locked" ? "LOCKED" : status === "blocked" ? "BLOCK" : "WARN";
}

function printReport(): void {
  const input = getScenario();
  const report = buildPreApiFreezeReport(input);

  console.log("=== Pre-API Freeze Report ===");
  console.log("");
  printHeader("Status", report.status);
  printHeader("API Integration Allowed", report.apiIntegrationAllowed);
  printHeader("External Model Call Allowed", report.externalModelCallAllowedByReport);
  printHeader("Real Base Write Allowed", report.realBaseWriteAllowedByReport);

  console.log("");
  console.log("--- Checks ---");
  for (const check of report.checks) {
    console.log(`  [${statusTag(check.status)}] ${check.name}: ${check.summary}`);
  }

  console.log("");
  console.log("--- Allowed Next Changes ---");
  for (const change of report.allowedNextChanges) {
    console.log(`  - ${change}`);
  }

  console.log("");
  console.log("--- Blocked Changes ---");
  for (const change of report.blockedChanges) {
    console.log(`  - ${change}`);
  }

  console.log("");
  printHeader("Final Note", report.finalNote);
  console.log("");
  console.log("Done.");
}

function getScenario(): PreApiFreezeInput {
  if (sampleFrozen) {
    return {
      schemasLocked: true,
      stateMachineLocked: true,
      baseWriteGuardsLocked: true,
      redactionPolicyLocked: true,
      deterministicDemoPassing: true,
      releaseGatePassing: true,
      llmAdapterBoundaryDefined: true,
    };
  }

  if (sampleNeedsReview) {
    return {
      schemasLocked: true,
      stateMachineLocked: true,
      baseWriteGuardsLocked: true,
      redactionPolicyLocked: true,
      deterministicDemoPassing: false,
      releaseGatePassing: true,
      llmAdapterBoundaryDefined: true,
    };
  }

  if (sampleBlocked) {
    return {
      schemasLocked: false,
      stateMachineLocked: true,
      baseWriteGuardsLocked: true,
      redactionPolicyLocked: true,
      deterministicDemoPassing: true,
      releaseGatePassing: true,
      llmAdapterBoundaryDefined: true,
    };
  }

  return {
    schemasLocked: true,
    stateMachineLocked: true,
    baseWriteGuardsLocked: true,
    redactionPolicyLocked: true,
    deterministicDemoPassing: false,
    releaseGatePassing: false,
    llmAdapterBoundaryDefined: false,
  };
}

printReport();
