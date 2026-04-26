import { DeterministicLlmClient } from "../src/llm/deterministic-client.js";
import { runCandidatePipeline } from "../src/orchestrator/candidate-pipeline.js";
import { buildHumanDecisionPlan } from "../src/orchestrator/human-decision.js";
import { runAnalytics } from "../src/agents/analytics.js";
import {
  buildMvpDemoResolutionPlan,
  buildMvpRecordContext,
  MVP_CANDIDATE_IDENTITY,
  MVP_JOB_IDENTITY,
} from "../src/base/mvp-resolution.js";
import {
  recordIdentityKey,
  resolveRecordsFromOutputs,
} from "../src/base/record-resolution.js";

// Simulated resolution outputs (would come from real lark-cli in production)
const RESOLVED_JOB_RECORD_ID = "rec_demo_job_001";
const RESOLVED_CANDIDATE_RECORD_ID = "rec_demo_candidate_001";

const sampleJobStdout = JSON.stringify({
  items: [
    {
      record_id: RESOLVED_JOB_RECORD_ID,
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
      record_id: RESOLVED_CANDIDATE_RECORD_ID,
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

// Stage 0: Record Resolution
console.log("=== Stage 0: Record Resolution ===");
const resolutionPlan = buildMvpDemoResolutionPlan();
console.log(`  Resolution commands: ${resolutionPlan.commands.length}`);
console.log(`  Identities: ${resolutionPlan.identities.length}`);

const resolvedRecords = resolveRecordsFromOutputs(
  [MVP_JOB_IDENTITY, MVP_CANDIDATE_IDENTITY],
  {
    [recordIdentityKey(MVP_JOB_IDENTITY)]: sampleJobStdout,
    [recordIdentityKey(MVP_CANDIDATE_IDENTITY)]: sampleCandidateStdout,
  },
);
const ctx = buildMvpRecordContext(resolvedRecords);
console.log(`  job record: resolved`);
console.log(`  candidate record: resolved`);

// Stage 1: Agent Pipeline (using resolved record IDs)
console.log("");
console.log("=== Stage 1: Candidate Pipeline ===");
const client = new DeterministicLlmClient();
const pipeline = await runCandidatePipeline(client, {
  candidateRecordId: ctx.candidateRecordId,
  jobRecordId: ctx.jobRecordId,
  candidateId: "cand_demo_001",
  jobId: "job_demo_ai_pm_001",
  resumeText:
    "AI Product Manager with 6 years experience in technology sector. " +
    "Led development of a natural language search feature at a fictional tech company. " +
    "Managed cross-functional teams of 8-12 engineers and designers. " +
    "Bachelor's degree in Computer Science from Fictional University. " +
    "Skills: product roadmapping, SQL, Python basics, A/B testing, user research.",
  jobRequirements:
    "5+ years in product management. Experience with AI/ML products. " +
    "Familiarity with NLP or recommendation systems. Cross-functional collaboration. " +
    "Data-driven decision making.",
  jobRubric:
    "Technical depth: understanding of ML pipeline and model lifecycle. " +
    "Product sense: ability to prioritize features and define success metrics. " +
    "Communication: clarity in writing specs and presenting to stakeholders.",
});
console.log(`  Final status: ${pipeline.finalStatus}`);
console.log(`  Completed: ${pipeline.completed}`);
console.log(`  Pipeline commands: ${pipeline.commands.length}`);

// Stage 2: Human Decision (using resolved record IDs)
console.log("");
console.log("=== Stage 2: Human Decision ===");
const decision = buildHumanDecisionPlan({
  candidateRecordId: ctx.candidateRecordId,
  candidateId: "cand_demo_001",
  decision: "offer",
  decidedBy: "demo_hiring_manager",
  decisionNote: "Strong technical depth and product sense. Interview confirmed communication skills. Approved for offer.",
  fromStatus: "decision_pending",
});
console.log(`  Final status: ${decision.finalStatus}`);
console.log(`  Decision commands: ${decision.commands.length}`);

// Stage 3: Analytics Report
console.log("");
console.log("=== Stage 3: Analytics Report ===");
const report = await runAnalytics(client, {
  reportId: "rpt_2026_w17",
  periodStart: "2026-04-19 00:00:00",
  periodEnd: "2026-04-25 23:59:59",
  candidates: [
    { candidateId: "cand_demo_001", status: decision.finalStatus, screeningRecommendation: "strong_match", talentPoolCandidate: false },
  ],
  evaluations: [
    { candidateId: "cand_demo_001", dimension: "technical_depth", rating: "strong", recommendation: "strong_match", fairnessFlags: [], talentPoolSignal: null },
    { candidateId: "cand_demo_001", dimension: "product_sense", rating: "strong", recommendation: "strong_match", fairnessFlags: [], talentPoolSignal: null },
    { candidateId: "cand_demo_001", dimension: "communication", rating: "medium", recommendation: "strong_match", fairnessFlags: [], talentPoolSignal: null },
  ],
  agentRuns: pipeline.agentRuns.map((r) => ({
    agentName: r.agent_name,
    runStatus: r.run_status,
  })),
});
console.log(`  Report ID: ${report.agentRun.entity_ref}`);
console.log(`  Run status: ${report.agentRun.run_status}`);
console.log(`  Report commands: ${report.commands.length}`);

// Summary
const resolutionCmds = resolutionPlan.commands.length;
const totalCommands = resolutionCmds + pipeline.commands.length + decision.commands.length + report.commands.length;
console.log("");
console.log("=== Live-Ready MVP Summary ===");
console.log(`  Resolution: ${resolutionCmds} command(s), 2 records resolved`);
console.log(`  Pipeline: ${pipeline.finalStatus} (completed: ${pipeline.completed})`);
console.log(`  Decision: ${decision.finalStatus}`);
console.log(`  Report: ${report.agentRun.run_status}`);
console.log(`  Total commands: ${totalCommands}`);
console.log("");
console.log("--- Full Command Plan ---");
const allCommands = [
  ...resolutionPlan.commands.map((c) => ({ stage: "resolution", desc: c.description })),
  ...pipeline.commands.map((c) => ({ stage: "pipeline", desc: c.description })),
  ...decision.commands.map((c) => ({ stage: "decision", desc: c.description })),
  ...report.commands.map((c) => ({ stage: "report", desc: c.description })),
];
for (let i = 0; i < allCommands.length; i++) {
  const cmd = allCommands[i]!;
  console.log(`  [${i + 1}] [${cmd.stage}] ${cmd.desc}`);
}
