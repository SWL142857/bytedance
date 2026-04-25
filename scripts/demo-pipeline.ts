import { DeterministicLlmClient } from "../src/llm/deterministic-client.js";
import { runCandidatePipeline } from "../src/orchestrator/candidate-pipeline.js";

const client = new DeterministicLlmClient();

const result = await runCandidatePipeline(client, {
  candidateRecordId: "rec_demo_candidate_001",
  jobRecordId: "rec_demo_job_001",
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

console.log("=== HireLoop Demo Pipeline ===");
console.log(`Final status: ${result.finalStatus}`);
console.log(`Completed: ${result.completed}`);
if (result.failedAgent) {
  console.log(`Failed agent: ${result.failedAgent}`);
}
console.log(`Agent runs: ${result.agentRuns.length}`);
console.log(`Commands: ${result.commands.length}`);
console.log("");
console.log("--- Command Plan ---");
for (let i = 0; i < result.commands.length; i++) {
  console.log(`  [${i + 1}] ${result.commands[i]!.description}`);
}
