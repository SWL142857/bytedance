import { DeterministicLlmClient } from "../src/llm/deterministic-client.js";
import { runAnalytics } from "../src/agents/analytics.js";

const client = new DeterministicLlmClient();

const result = await runAnalytics(client, {
  reportId: "rpt_2026_w17",
  periodStart: "2026-04-19 00:00:00",
  periodEnd: "2026-04-25 23:59:59",
  candidates: [
    { candidateId: "cand_001", status: "decision_pending", screeningRecommendation: "strong_match", talentPoolCandidate: false },
    { candidateId: "cand_002", status: "screened", screeningRecommendation: "review_needed", talentPoolCandidate: true },
    { candidateId: "cand_003", status: "parsed", screeningRecommendation: null, talentPoolCandidate: false },
    { candidateId: "cand_004", status: "new", screeningRecommendation: null, talentPoolCandidate: false },
  ],
  evaluations: [
    { candidateId: "cand_001", dimension: "technical_depth", rating: "strong", recommendation: "strong_match", fairnessFlags: [], talentPoolSignal: null },
    { candidateId: "cand_001", dimension: "product_sense", rating: "strong", recommendation: "strong_match", fairnessFlags: [], talentPoolSignal: null },
  ],
  agentRuns: [
    { agentName: "resume_parser", runStatus: "success" },
    { agentName: "screening", runStatus: "success" },
    { agentName: "interview_kit", runStatus: "success" },
    { agentName: "hr_coordinator", runStatus: "success" },
    { agentName: "resume_parser", runStatus: "failed" },
  ],
});

console.log("=== HireLoop Demo Report ===");
console.log(`Report ID: ${result.agentRun.entity_ref}`);
console.log(`Agent run status: ${result.agentRun.run_status}`);
console.log(`Commands: ${result.commands.length}`);
console.log("");
console.log("--- Command Plan ---");
for (let i = 0; i < result.commands.length; i++) {
  console.log(`  [${i + 1}] ${result.commands[i]!.description}`);
}
