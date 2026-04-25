import { seedFromInternal } from "../base/commands.js";

export const DEMO_JOB_ID = "job_demo_ai_pm_001";
export const DEMO_CANDIDATE_ID = "cand_demo_001";

export const DEMO_JOB = seedFromInternal("jobs", {
  job_id: DEMO_JOB_ID,
  title: "AI Product Manager",
  department: "Product",
  level: "P7",
  requirements:
    "5+ years in product management. Experience with AI/ML products. " +
    "Familiarity with NLP or recommendation systems. Cross-functional collaboration. " +
    "Data-driven decision making.",
  rubric:
    "Technical depth: understanding of ML pipeline and model lifecycle. " +
    "Product sense: ability to prioritize features and define success metrics. " +
    "Communication: clarity in writing specs and presenting to stakeholders.",
  status: "open",
  owner: "demo_hiring_manager",
  created_at: "2026-04-25 00:00:00",
});

export const DEMO_CANDIDATE = seedFromInternal("candidates", {
  candidate_id: DEMO_CANDIDATE_ID,
  display_name: "Candidate-Alpha",
  resume_source: null,
  resume_text:
    "AI Product Manager with 6 years experience in technology sector. " +
    "Led development of a natural language search feature at a fictional tech company. " +
    "Managed cross-functional teams of 8-12 engineers and designers. " +
    "Bachelor's degree in Computer Science from Fictional University. " +
    "Skills: product roadmapping, SQL, Python basics, A/B testing, user research.",
  status: "new",
  screening_recommendation: null,
  talent_pool_candidate: false,
  human_decision: "none",
  human_decision_by: null,
  human_decision_note: null,
});

export const ALL_DEMO_SEEDS = [DEMO_JOB, DEMO_CANDIDATE];
