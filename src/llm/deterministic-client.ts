import type { LlmClient, LlmRequest, LlmResponse } from "./client.js";

const DETERMINISTIC_RESPONSES: Record<string, string> = {
  // ── P3 Competition agents ──
  extraction_v1: JSON.stringify({
    skills: [
      { name: "Product Management", canonicalName: "Product Management", confidence: 1.0, evidence: "6 years as Product Manager" },
      { name: "SQL", canonicalName: "SQL", confidence: 0.9, evidence: "SQL and data analysis experience" },
      { name: "A/B Testing", canonicalName: "A/B Testing", confidence: 0.85, evidence: "A/B testing for product decisions" },
      { name: "Cross-functional Leadership", canonicalName: "Cross-functional Leadership", confidence: 0.8, evidence: "Led cross-functional teams" },
    ],
    features: [
      { featureType: "experience", featureName: "Product Management Tenure", canonicalName: "PM Tenure", featureValue: "6 years", confidence: 1.0, evidence: "6 years in product management" },
      { featureType: "capability", featureName: "Data-driven Decision Making", canonicalName: "Data Analysis", featureValue: "SQL, Python, A/B testing", confidence: 0.9, evidence: "SQL and Python for data analysis" },
      { featureType: "capability", featureName: "Team Leadership", canonicalName: "Team Leadership", featureValue: "Led cross-functional teams", confidence: 0.8, evidence: "Cross-functional team leadership" },
    ],
    profile: {
      yearsOfExperience: "6",
      educationLevel: "Bachelor's",
      industryBackground: "Technology",
      leadershipLevel: "senior",
      communicationLevel: "proficient",
      systemDesignLevel: "proficient",
      structuredSummary: "Candidate has 6 years of product management experience in the technology sector, with strong data analysis skills and proven cross-functional leadership. Well-suited for senior PM roles requiring technical depth and team coordination.",
    },
  }),
  reviewer_v1: JSON.stringify({
    decisionPred: "select",
    confidence: 0.85,
    reasonLabel: "Strong Product Management Fit",
    reasonGroup: "skill_match",
    reviewSummary: "Candidate demonstrates 6 years of product management experience with strong data analysis skills (SQL, A/B testing) and cross-functional leadership. Profile aligns well with role requirements for technical depth and product sense. Top neighbors show similar strong-match profiles.",
  }),
  graph_builder_v1: JSON.stringify({
    shouldLink: true,
    linkReason: "Candidates share senior product leadership and data-driven decision signals.",
    sharedSignals: ["Product Management", "Data Analysis", "Team Leadership"],
  }),
  // ── Legacy agents (retained for backward compat) ──
  resume_parser_v1: JSON.stringify({
    facts: [
      { factType: "work_experience", factText: "5 years as Product Manager at a technology company", sourceExcerpt: null, confidence: "high" },
      { factType: "skill", factText: "SQL, Python basics, A/B testing", sourceExcerpt: null, confidence: "medium" },
      { factType: "education", factText: "Bachelor's degree in Computer Science", sourceExcerpt: null, confidence: "high" },
    ],
    parseStatus: "success",
  }),
  screening_v1: JSON.stringify({
    recommendation: "strong_match",
    dimensionRatings: [
      { dimension: "technical_depth", rating: "strong", reason: "Solid ML pipeline understanding", evidenceRefs: [] },
      { dimension: "product_sense", rating: "strong", reason: "Clear feature prioritization", evidenceRefs: [] },
      { dimension: "communication", rating: "medium", reason: "Good written specs", evidenceRefs: [] },
    ],
    fairnessFlags: [],
    talentPoolSignal: null,
  }),
  interview_kit_v1: JSON.stringify({
    questions: [
      { question: "Walk me through how you would design a recommendation system for a new product line.", purpose: "Assess technical depth and ML pipeline understanding", followUps: ["How would you handle cold start?", "What metrics would you track?"] },
      { question: "Describe a time when you had to prioritize competing features with limited engineering resources.", purpose: "Evaluate product sense and prioritization skills", followUps: ["What tradeoffs did you make?", "How did you communicate the decision?"] },
      { question: "Present a technical spec you wrote to a non-technical stakeholder - how do you structure it?", purpose: "Test communication clarity", followUps: ["How do you handle pushback?", "What format works best?"] },
    ],
    scorecardDimensions: ["technical_depth", "product_sense", "communication"],
    focusAreas: ["ML system design", "feature prioritization", "cross-functional collaboration"],
    riskChecks: ["Check for over-reliance on single metric", "Verify hands-on vs advisory experience split"],
  }),
  hr_coordinator_v1: JSON.stringify({
    handoffSummary: "Candidate shows strong technical depth and product sense. Communication rated medium. Interview kit prepared with 3 targeted questions.",
    nextStep: "human_decision",
    coordinatorChecklist: [
      "Review interview kit questions for role alignment",
      "Confirm interview panel availability",
      "Check candidate screening recommendation",
      "Schedule follow-up with hiring manager",
    ],
  }),
  analytics_v1: JSON.stringify({
    funnelSummary: "Candidates moved through the pipeline with active records across new, parsed, screened, and decision_pending stages. No offers or rejections were generated by agents.",
    qualitySummary: "Strong technical depth across candidates. Product sense ratings above average. Communication remains a common development area.",
    bottlenecks: ["Screening stage has 25% drop-off rate", "Interview kit generation waiting on evaluation completion"],
    talentPoolSuggestions: ["2 weak_match candidates show strong technical skills — consider for future openings", "1 candidate flagged for cross-role potential"],
    recommendations: ["Add structured communication assessment to rubric", "Reduce screening drop-off by pre-populating evaluation dimensions"],
  }),
};

export class DeterministicLlmClient implements LlmClient {
  private responses: Record<string, string>;

  constructor(overrides?: Record<string, string>) {
    this.responses = { ...DETERMINISTIC_RESPONSES, ...overrides };
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const content = this.responses[request.promptTemplateId];
    if (content === undefined) {
      throw new Error(
        `No deterministic response for template "${request.promptTemplateId}". ` +
        `Available: ${Object.keys(this.responses).join(", ")}`,
      );
    }
    return { content, promptTemplateId: request.promptTemplateId };
  }
}
