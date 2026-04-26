import { runRecordResolutionPlan } from "../src/base/record-resolution-runner.js";
import {
  recordIdentityKey,
  resolveRecordsFromOutputs,
  type ResolvedRecord,
} from "../src/base/record-resolution.js";
import {
  MVP_CANDIDATE_IDENTITY,
  MVP_JOB_IDENTITY,
} from "../src/base/mvp-resolution.js";
import { loadConfig } from "../src/config.js";
import {
  LIVE_MVP_WRITE_CONFIRMATION,
  runLiveMvpWrites,
} from "../src/orchestrator/live-mvp-runner.js";
import { buildLiveMvpExecutionAudit } from "../src/orchestrator/live-mvp-audit.js";

const args = process.argv.slice(2);
const useReadonlyResolution = args.includes("--use-readonly-resolution");
const execute = args.includes("--execute");
const confirmation = args
  .find((arg) => arg.startsWith("--confirm="))
  ?.slice("--confirm=".length);
const MVP_IDENTITIES = [MVP_JOB_IDENTITY, MVP_CANDIDATE_IDENTITY];

function makeSampleStdout(records: Array<{ id: string; fields: Record<string, unknown> }>): string {
  return JSON.stringify({
    items: records.map((r) => ({ record_id: r.id, fields: r.fields })),
    total: records.length,
    has_more: false,
  });
}

function buildSampleResolvedRecords(): ResolvedRecord[] {
  return resolveRecordsFromOutputs(
    MVP_IDENTITIES,
    {
      [recordIdentityKey(MVP_JOB_IDENTITY)]: makeSampleStdout([
        { id: "rec_demo_job_001", fields: { job_id: "job_demo_ai_pm_001" } },
      ]),
      [recordIdentityKey(MVP_CANDIDATE_IDENTITY)]: makeSampleStdout([
        { id: "rec_demo_candidate_001", fields: { candidate_id: "cand_demo_001" } },
      ]),
    },
  );
}

function printResultHeader(label: string, value: string | number | boolean): void {
  console.log(`  ${label}: ${value}`);
}

async function resolveRecords(): Promise<ResolvedRecord[] | null> {
  if (!useReadonlyResolution) {
    console.log("Resolution source: sample");
    return buildSampleResolvedRecords();
  }

  console.log("Resolution source: read-only live resolution");
  const resolution = runRecordResolutionPlan({
    identities: MVP_IDENTITIES,
    config: loadConfig(),
    execute: true,
  });

  if (resolution.runResult.blocked) {
    console.log("Read-only resolution blocked. No write run generated.");
    for (const result of resolution.runResult.results) {
      console.log(`  - ${result.status}: ${result.description}`);
    }
    return null;
  }

  if (resolution.resolvedRecords.length !== MVP_IDENTITIES.length) {
    console.log(`Read-only resolution failed (${resolution.resolvedRecords.length} resolved records). No write run generated.`);
    return null;
  }

  return resolution.resolvedRecords;
}

async function main(): Promise<void> {
  console.log("=== Live MVP Write Runner ===");
  console.log("");

  if (execute && !useReadonlyResolution) {
    console.log("Execution blocked: --execute requires --use-readonly-resolution.");
    console.log("No write run generated.");
    return;
  }

  if (execute && confirmation !== LIVE_MVP_WRITE_CONFIRMATION) {
    console.log(`Execution blocked: --confirm=${LIVE_MVP_WRITE_CONFIRMATION} is required.`);
    console.log("No write run generated.");
    return;
  }

  const resolvedRecords = await resolveRecords();
  if (!resolvedRecords) return;

  console.log(`Resolved records: ${resolvedRecords.length}`);

  const run = await runLiveMvpWrites({
    resolvedRecords,
    resolutionSource: useReadonlyResolution ? "readonly" : "sample",
    config: loadConfig(),
    execute,
    confirmation,
    decision: "offer",
    decidedBy: "demo_hiring_manager",
    decisionNote: "Strong technical depth and product sense. Interview confirmed communication skills. Approved for offer.",
  });

  console.log("");
  console.log("=== Write Run ===");
  printResultHeader("Mode", execute ? "EXECUTE" : "DRY-RUN");
  printResultHeader("Blocked", run.blocked);
  printResultHeader("Executed", run.executed);
  printResultHeader("Total commands", run.plan.commands.length);
  printResultHeader("Results", run.results.length);
  if (run.blockedReasons.length > 0) {
    console.log("  Blocked reasons:");
    for (const reason of run.blockedReasons) {
      console.log(`    - ${reason}`);
    }
  }

  console.log("");
  console.log("--- Result Details ---");
  for (let i = 0; i < run.results.length; i++) {
    const result = run.results[i]!;
    console.log(`  [${i + 1}] ${result.status}: ${result.description}`);
  }

  console.log("");
  console.log("=== Execution Audit ===");
  const audit = buildLiveMvpExecutionAudit(run);
  printResultHeader("mode", audit.mode);
  printResultHeader("blocked", audit.blocked);
  printResultHeader("executed", audit.executed);
  printResultHeader("totalCommands", audit.totalCommands);
  printResultHeader("planned", audit.plannedCount);
  printResultHeader("skipped", audit.skippedCount);
  printResultHeader("success", audit.successCount);
  printResultHeader("failed", audit.failedCount);
  printResultHeader(
    "stoppedAtCommandIndex",
    audit.stoppedAtCommandIndex ?? "null",
  );
  printResultHeader(
    "stoppedAtDescription",
    audit.stoppedAtDescription ?? "null",
  );
  printResultHeader("recoveryNote", audit.recoveryNote);

  console.log("");
  console.log("Done.");
}

main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
