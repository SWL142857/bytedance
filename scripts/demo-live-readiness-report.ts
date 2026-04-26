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
import { loadConfig, validateExecutionConfig } from "../src/config.js";
import {
  buildLiveMvpPlan,
} from "../src/orchestrator/live-mvp-plan.js";
import {
  assertLiveMvpWriteCommands,
  LiveMvpWriteBlockedError,
} from "../src/orchestrator/live-mvp-runner.js";
import {
  buildLiveReadinessReport,
} from "../src/orchestrator/live-readiness-report.js";

const args = process.argv.slice(2);
const useReadonlyResolution = args.includes("--use-readonly-resolution");
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

function printHeader(label: string, value: string | number | boolean): void {
  console.log(`  ${label}: ${value}`);
}

function runWithSuppressedConsole<T>(fn: () => T): T {
  const originalLog = console.log;
  const originalError = console.error;
  const noop = (..._args: unknown[]) => {};
  console.log = noop as typeof console.log;
  console.error = noop as typeof console.error;
  try {
    return fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

async function main(): Promise<void> {
  console.log("=== Live Readiness Report ===");
  console.log("");

  const resolutionMode = useReadonlyResolution ? "readonly" : "sample";
  const config = loadConfig();
  const configErrors = validateExecutionConfig(config);
  const requiredRecordCount = MVP_IDENTITIES.length;

  let resolutionBlocked = false;
  let resolvedRecords: ResolvedRecord[] = [];

  if (useReadonlyResolution) {
    console.log("Resolution source: read-only live resolution");
    if (configErrors.length > 0) {
      resolutionBlocked = true;
    } else {
      try {
        const resolution = runWithSuppressedConsole(() =>
          runRecordResolutionPlan({
            identities: MVP_IDENTITIES,
            config,
            execute: true,
          }),
        );
        resolutionBlocked = resolution.runResult.blocked;
        if (!resolutionBlocked) {
          resolvedRecords = resolution.resolvedRecords;
        }
      } catch {
        resolutionBlocked = true;
      }
    }
  } else {
    console.log("Resolution source: sample");
    resolvedRecords = buildSampleResolvedRecords();
  }

  const planCommands = await buildPlanCommands(
    resolutionBlocked,
    resolvedRecords,
    requiredRecordCount,
  );

  const report = buildLiveReadinessReport({
    resolutionMode,
    configErrors,
    resolutionBlocked,
    resolvedRecords,
    requiredRecordCount,
    planCommands: planCommands.commands,
    planError: planCommands.error,
    invalidWriteCommands: planCommands.invalidWriteCommands,
  });

  console.log("");
  printHeader("Ready", report.ready);
  printHeader("Safe to Execute Live Writes", report.safeToExecuteLiveWrites);
  printHeader("Resolution Mode", report.resolutionMode);
  printHeader("Resolved Records", report.resolvedRecordCount);
  printHeader("Required Records", report.requiredRecordCount);
  printHeader("Planned Write Count", report.plannedWriteCount);
  printHeader("Checked At", report.checkedAt);

  console.log("");
  console.log("--- Checks ---");
  for (const check of report.checks) {
    console.log(`  [${check.status.toUpperCase()}] ${check.name}: ${check.summary}`);
  }

  console.log("");
  printHeader("Next Step", report.nextStep);
  console.log("");
}

async function buildPlanCommands(
  resolutionBlocked: boolean,
  resolvedRecords: ResolvedRecord[],
  requiredRecordCount: number,
): Promise<{
  commands: import("../src/base/commands.js").BaseCommandSpec[] | null;
  error: string | null;
  invalidWriteCommands: string[];
}> {
  if (resolutionBlocked || resolvedRecords.length < requiredRecordCount) {
    return { commands: null, error: null, invalidWriteCommands: [] };
  }

  try {
    const plan = await buildLiveMvpPlan({
      resolvedRecords,
      decision: "offer",
      decidedBy: "demo_hiring_manager",
      decisionNote: "Strong technical depth and product sense. Interview confirmed communication skills. Approved for offer.",
    });

    const invalidWriteCommands: string[] = [];
    try {
      assertLiveMvpWriteCommands(plan.commands);
    } catch (err) {
      if (err instanceof LiveMvpWriteBlockedError) {
        invalidWriteCommands.push(...err.blockedCommands);
      } else {
        throw err;
      }
    }

    return { commands: plan.commands, error: null, invalidWriteCommands };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { commands: null, error, invalidWriteCommands: [] };
  }
}

main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
