import {
  buildMvpDemoResolutionPlan,
  buildMvpRecordContext,
  MVP_JOB_IDENTITY,
  MVP_CANDIDATE_IDENTITY,
} from "../src/base/mvp-resolution.js";
import {
  recordIdentityKey,
  resolveRecordsFromOutputs,
} from "../src/base/record-resolution.js";
import { runRecordResolutionPlan } from "../src/base/record-resolution-runner.js";
import { loadConfig } from "../src/config.js";

const args = process.argv.slice(2);
const isSampleParse = args.includes("--sample-parse");
const isExecuteReadonly = args.includes("--execute-readonly");

console.log("=== MVP Demo Record Resolution ===");
console.log("");

const plan = buildMvpDemoResolutionPlan();
console.log(`Resolution plan: ${plan.commands.length} list command(s), ${plan.identities.length} identit(ies)`);

for (const id of plan.identities) {
  console.log(`  - ${id.tableName}.${id.businessField} = "${id.businessId}"`);
}

console.log("");
console.log("--- Resolution Commands ---");
for (let i = 0; i < plan.commands.length; i++) {
  const cmd = plan.commands[i]!;
  console.log(`  [${i + 1}] ${cmd.description}`);
}

if (isExecuteReadonly) {
  console.log("");
  console.log("=== Execute Read-Only (--execute-readonly) ===");

  const config = loadConfig();
  const result = runRecordResolutionPlan({
    identities: [MVP_JOB_IDENTITY, MVP_CANDIDATE_IDENTITY],
    config,
    execute: true,
  });

  console.log(`  Blocked: ${result.runResult.blocked}`);
  console.log(`  Command results:`);
  for (const r of result.runResult.results) {
    console.log(`    - ${r.status}: ${r.description}`);
  }
  console.log(`  Resolved records: ${result.resolvedRecords.length}`);
  for (const rec of result.resolvedRecords) {
    console.log(`    - ${rec.businessId} -> ${rec.recordId}`);
  }

  if (result.resolvedRecords.length > 0) {
    const ctx = buildMvpRecordContext(result.resolvedRecords);
    console.log("");
    console.log("=== MVP Record Context ===");
    console.log(`  jobRecordId: ${ctx.jobRecordId}`);
    console.log(`  candidateRecordId: ${ctx.candidateRecordId}`);
  }
}

if (isSampleParse) {
  console.log("");
  console.log("=== Sample Parse (--sample-parse) ===");

  const sampleJobStdout = JSON.stringify({
    items: [
      {
        record_id: "recJob001",
        fields: {
          job_id: "job_demo_ai_pm_001",
          title: "AI Product Manager",
          status: "open",
        },
      },
    ],
    total: 1,
    has_more: false,
  });

  const sampleCandidateStdout = JSON.stringify({
    items: [
      {
        record_id: "recCand001",
        fields: {
          candidate_id: "cand_demo_001",
          display_name: "Demo Candidate",
          status: "new",
        },
      },
    ],
    total: 1,
    has_more: false,
  });

  const resolved = resolveRecordsFromOutputs(
    [MVP_JOB_IDENTITY, MVP_CANDIDATE_IDENTITY],
    {
      [recordIdentityKey(MVP_JOB_IDENTITY)]: sampleJobStdout,
      [recordIdentityKey(MVP_CANDIDATE_IDENTITY)]: sampleCandidateStdout,
    },
  );

  const jobResolved = resolved.find((r) => r.tableName === "jobs")!;
  console.log(`  Job: ${jobResolved.businessId} -> ${jobResolved.recordId}`);

  const candResolved = resolved.find((r) => r.tableName === "candidates")!;
  console.log(`  Candidate: ${candResolved.businessId} -> ${candResolved.recordId}`);

  const ctx = buildMvpRecordContext(resolved);
  console.log("");
  console.log("=== MVP Record Context ===");
  console.log(`  jobRecordId: ${ctx.jobRecordId}`);
  console.log(`  candidateRecordId: ${ctx.candidateRecordId}`);
}

console.log("");
console.log("Done.");
