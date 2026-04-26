import {
  buildApiBoundaryReleaseAuditReport,
  type ApiBoundaryAuditInput,
} from "../src/orchestrator/api-boundary-release-audit.js";

const args = process.argv.slice(2);
const sampleReady = args.includes("--sample-ready");
const sampleNeedsReview = args.includes("--sample-needs-review");
const sampleBlocked = args.includes("--sample-blocked");

function printHeader(label: string, value: string | number | boolean): void {
  console.log(`  ${label}: ${value}`);
}

function main(): void {
  const input = getScenario();
  const report = buildApiBoundaryReleaseAuditReport(input);

  console.log(`=== ${report.title} ===`);
  console.log("");
  printHeader("Status", report.status);
  printHeader("Default External Model Calls Permitted", report.defaultExternalModelCallsPermittedByReport);
  printHeader("Real Base Writes Permitted", report.realBaseWritesPermittedByReport);
  printHeader("Provider Smoke Guarded", report.providerSmokeGuarded);
  printHeader("Provider Agent Demo Guarded", report.providerAgentDemoGuarded);
  printHeader("Base Write Guard Independent", report.baseWriteGuardIndependent);
  printHeader("Deterministic Demo Safe", report.deterministicDemoSafe);
  printHeader("Output Redaction Safe", report.outputRedactionSafe);
  printHeader("Forbidden Trace Scan Passed", report.forbiddenTraceScanPassed);
  printHeader("Secret Scan Passed", report.secretScanPassed);
  printHeader("Release Gate Consistent", report.releaseGateConsistent);

  console.log("");
  console.log("--- Checks ---");
  for (const check of report.checks) {
    console.log(`  [${check.status.toUpperCase()}] ${check.name}: ${check.summary}`);
  }

  console.log("");
  console.log("--- Recommended Commands ---");
  for (const cmd of report.recommendedCommands) {
    console.log(`  ${cmd}`);
  }

  console.log("");
  printHeader("Final Note", report.finalNote);
  console.log("");
  console.log("Done.");
}

function getScenario(): ApiBoundaryAuditInput {
  if (sampleReady) {
    return {
      typecheckPassed: true,
      testsPassed: true,
      buildPassed: true,
      deterministicDemoPassed: true,
      providerSmokeGuarded: true,
      providerAgentDemoGuarded: true,
      baseWriteGuardIndependent: true,
      outputRedactionSafe: true,
      forbiddenTraceScanPassed: true,
      secretScanPassed: true,
      releaseGateConsistent: true,
    };
  }

  if (sampleNeedsReview) {
    return {
      typecheckPassed: true,
      testsPassed: true,
      buildPassed: true,
      deterministicDemoPassed: true,
      providerSmokeGuarded: true,
      providerAgentDemoGuarded: true,
      baseWriteGuardIndependent: true,
      outputRedactionSafe: true,
      forbiddenTraceScanPassed: true,
      secretScanPassed: true,
      releaseGateConsistent: false,
    };
  }

  if (sampleBlocked) {
    return {
      typecheckPassed: false,
      testsPassed: false,
      buildPassed: false,
      deterministicDemoPassed: false,
      providerSmokeGuarded: false,
      providerAgentDemoGuarded: false,
      baseWriteGuardIndependent: false,
      outputRedactionSafe: false,
      forbiddenTraceScanPassed: false,
      secretScanPassed: false,
      releaseGateConsistent: false,
    };
  }

  return {
    typecheckPassed: true,
    testsPassed: true,
    buildPassed: true,
    deterministicDemoPassed: true,
    providerSmokeGuarded: true,
    providerAgentDemoGuarded: true,
    baseWriteGuardIndependent: true,
    outputRedactionSafe: true,
    forbiddenTraceScanPassed: false,
    secretScanPassed: true,
    releaseGateConsistent: true,
  };
}

main();
