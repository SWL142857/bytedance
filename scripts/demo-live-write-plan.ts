import { buildLiveMvpPlan } from "../src/orchestrator/live-mvp-plan.js";
import { runRecordResolutionPlan } from "../src/base/record-resolution-runner.js";
import { resolveRecordsFromOutputs, recordIdentityKey, type ResolvedRecord } from "../src/base/record-resolution.js";
import { MVP_JOB_IDENTITY, MVP_CANDIDATE_IDENTITY } from "../src/base/mvp-resolution.js";
import { loadConfig } from "../src/config.js";

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

async function main() {
  console.log("=== Live MVP Write Plan ===");
  console.log("");

  let resolvedRecords: ResolvedRecord[];

  if (useReadonlyResolution) {
    console.log("Resolution source: read-only live resolution");
    const config = loadConfig();
    const result = runRecordResolutionPlan({
      identities: MVP_IDENTITIES,
      config,
      execute: true,
    });

    if (result.runResult.blocked) {
      console.log("Read-only resolution blocked. No write plan generated.");
      console.log(`  Blocked: true`);
      for (const r of result.runResult.results) {
        console.log(`  - ${r.status}: ${r.description}`);
      }
      return;
    }

    if (result.resolvedRecords.length !== MVP_IDENTITIES.length) {
      console.log(`Read-only resolution failed (${result.resolvedRecords.length} resolved records). No write plan generated.`);
      return;
    }

    resolvedRecords = result.resolvedRecords;
  } else {
    console.log("Resolution source: sample");

    const sampleJobStdout = makeSampleStdout([
      { id: "rec_demo_job_001", fields: { job_id: "job_demo_ai_pm_001" } },
    ]);
    const sampleCandidateStdout = makeSampleStdout([
      { id: "rec_demo_candidate_001", fields: { candidate_id: "cand_demo_001" } },
    ]);

    resolvedRecords = resolveRecordsFromOutputs(
      MVP_IDENTITIES,
      {
        [recordIdentityKey(MVP_JOB_IDENTITY)]: sampleJobStdout,
        [recordIdentityKey(MVP_CANDIDATE_IDENTITY)]: sampleCandidateStdout,
      },
    );
  }

  console.log(`Resolved records: ${resolvedRecords.length}`);

  const plan = await buildLiveMvpPlan({
    resolvedRecords,
    decision: "offer",
    decidedBy: "demo_hiring_manager",
    decisionNote: "Strong technical depth and product sense. Interview confirmed communication skills. Approved for offer.",
  });

  console.log("");
  console.log("=== Write Plan ===");
  console.log(`  Pipeline final status: ${plan.pipeline.finalStatus}`);
  console.log(`  Pipeline completed: ${plan.pipeline.completed}`);
  console.log(`  Decision status: ${plan.finalDecisionStatus}`);
  console.log(`  Report status: ${plan.reportRunStatus}`);
  console.log(`  Total commands: ${plan.commands.length}`);
  console.log("");
  console.log("--- Command Details ---");
  for (let i = 0; i < plan.commands.length; i++) {
    const cmd = plan.commands[i]!;
    console.log(`  [${i + 1}] ${cmd.description} (writesRemote: ${cmd.writesRemote})`);
  }

  console.log("");
  console.log("Done.");
}

main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
