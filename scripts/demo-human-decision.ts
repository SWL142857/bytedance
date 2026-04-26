import { buildHumanDecisionPlan } from "../src/orchestrator/human-decision.js";

const result = buildHumanDecisionPlan({
  candidateRecordId: "rec_demo_candidate_001",
  candidateId: "cand_demo_001",
  decision: "offer",
  decidedBy: "demo_hiring_manager",
  decisionNote: "Strong technical depth and product sense. Interview confirmed communication skills. Approved for offer.",
  fromStatus: "decision_pending",
});

console.log("=== HireLoop Demo Human Decision ===");
console.log(`Candidate ID: cand_demo_001`);
console.log(`Final status: ${result.finalStatus}`);
console.log(`Commands: ${result.commands.length}`);
console.log("");
console.log("--- Command Plan ---");
for (let i = 0; i < result.commands.length; i++) {
  console.log(`  [${i + 1}] ${result.commands[i]!.description}`);
}