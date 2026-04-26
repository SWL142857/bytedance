import {
  buildLiveRecoveryPlan,
  type LiveRecoveryPlan,
} from "../src/orchestrator/live-recovery-plan.js";
import type { LiveMvpExecutionAudit } from "../src/orchestrator/live-mvp-audit.js";

function printHeader(label: string, value: string | number | boolean | null): void {
  console.log(`  ${label}: ${value}`);
}

function printPlan(plan: LiveRecoveryPlan): void {
  printHeader("Status", plan.status);
  printHeader("Risk Level", plan.riskLevel);
  printHeader("Completed Commands", plan.completedCommandCount);
  printHeader("Likely Written", plan.likelyWrittenCommandCount);
  printHeader("Failed At Index", plan.failedCommandIndex);
  printHeader("Failed Description", plan.failedCommandDescription);
  if (plan.manualChecks.length > 0) {
    console.log("  Manual Checks:");
    for (const check of plan.manualChecks) {
      console.log(`    - ${check}`);
    }
  } else {
    console.log("  Manual Checks: (none)");
  }
  printHeader("Recommended Action", plan.recommendedAction);
  printHeader("Rerun Policy", plan.rerunPolicy);
}

function buildAudit(
  overrides: Partial<LiveMvpExecutionAudit>,
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

function main(): void {
  console.log("=== Live Recovery Plan Demo ===");
  console.log("");

  const scenarios: Array<{ name: string; audit: LiveMvpExecutionAudit }> = [
    {
      name: "Dry-Run",
      audit: buildAudit({
        mode: "dry_run",
        blocked: false,
        executed: false,
        plannedCount: 20,
      }),
    },
    {
      name: "Blocked Execute",
      audit: buildAudit({
        mode: "execute",
        blocked: true,
        executed: false,
        plannedCount: 0,
        skippedCount: 20,
      }),
    },
    {
      name: "Failed at Command 4",
      audit: buildAudit({
        mode: "execute",
        blocked: false,
        executed: true,
        plannedCount: 0,
        successCount: 3,
        failedCount: 1,
        skippedCount: 16,
        totalCommands: 20,
        stoppedAtCommandIndex: 4,
        stoppedAtDescription: "Update candidate status: parsed -> screened",
      }),
    },
    {
      name: "All Success",
      audit: buildAudit({
        mode: "execute",
        blocked: false,
        executed: true,
        plannedCount: 0,
        successCount: 20,
        totalCommands: 20,
      }),
    },
  ];

  for (const scenario of scenarios) {
    console.log(`--- Scenario: ${scenario.name} ---`);
    const plan = buildLiveRecoveryPlan(scenario.audit);
    printPlan(plan);
    console.log("");
  }

  console.log("Done.");
}

main();
