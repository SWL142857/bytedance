import type { LlmClient, LlmRequest, LlmResponse } from "./client.js";

const DETERMINISTIC_RESPONSES: Record<string, string> = {
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
