import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseResumeParserOutput,
  parseScreeningOutput,
  parseInterviewKitOutput,
  parseAnalyticsOutput,
  SchemaValidationError,
} from "../src/agents/schemas.js";

const VALID_RESUME_OUTPUT = {
  facts: [
    { factType: "skill", factText: "TypeScript", sourceExcerpt: "3 years TypeScript", confidence: "high" },
  ],
  parseStatus: "success",
};

const VALID_SCREENING_OUTPUT = {
  recommendation: "strong_match",
  dimensionRatings: [
    { dimension: "skills", rating: "strong", reason: "Matches JD", evidenceRefs: ["f1"] },
  ],
  fairnessFlags: [],
  talentPoolSignal: null,
};

const VALID_INTERVIEW_KIT_OUTPUT = {
  questions: [
    { question: "Tell me about X", purpose: "Verify skill", followUps: ["Can you elaborate?"] },
  ],
  scorecardDimensions: ["technical", "communication"],
  focusAreas: ["system design"],
  riskChecks: ["employment gap"],
};

describe("schema parse — valid outputs", () => {
  it("parses valid ResumeParserOutput", () => {
    const result = parseResumeParserOutput(VALID_RESUME_OUTPUT);
    assert.equal(result.parseStatus, "success");
    assert.equal(result.facts.length, 1);
  });

  it("parses valid ScreeningOutput", () => {
    const result = parseScreeningOutput(VALID_SCREENING_OUTPUT);
    assert.equal(result.recommendation, "strong_match");
  });

  it("parses valid InterviewKitOutput", () => {
    const result = parseInterviewKitOutput(VALID_INTERVIEW_KIT_OUTPUT);
    assert.equal(result.questions.length, 1);
  });
});

describe("schema parse — forbidden keys rejected", () => {
  const forbiddenTopLevelKeys = [
    "reasoning_chain",
    "raw_resume",
    "full_resume",
    "raw_prompt",
    "full_prompt",
    "thinking",
    "chain_of_thought",
    "cot",
  ];

  for (const key of forbiddenTopLevelKeys) {
    it(`ResumeParserOutput rejects forbidden key "${key}"`, () => {
      const input = { ...VALID_RESUME_OUTPUT, [key]: "should not be here" };
      assert.throws(
        () => parseResumeParserOutput(input),
        (err: unknown) => {
          assert.ok(err instanceof SchemaValidationError);
          assert.match(err.message, /forbidden/i);
          return true;
        },
      );
    });

    it(`ScreeningOutput rejects forbidden key "${key}"`, () => {
      const input = { ...VALID_SCREENING_OUTPUT, [key]: "should not be here" };
      assert.throws(
        () => parseScreeningOutput(input),
        (err: unknown) => {
          assert.ok(err instanceof SchemaValidationError);
          assert.match(err.message, /forbidden/i);
          return true;
        },
      );
    });

    it(`InterviewKitOutput rejects forbidden key "${key}"`, () => {
      const input = { ...VALID_INTERVIEW_KIT_OUTPUT, [key]: "should not be here" };
      assert.throws(
        () => parseInterviewKitOutput(input),
        (err: unknown) => {
          assert.ok(err instanceof SchemaValidationError);
          assert.match(err.message, /forbidden/i);
          return true;
        },
      );
    });
  }
});

describe("schema parse — unknown keys rejected", () => {
  it("ResumeParserOutput rejects unknown top-level key", () => {
    const input = { ...VALID_RESUME_OUTPUT, extra_field: "oops" };
    assert.throws(
      () => parseResumeParserOutput(input),
      (err: unknown) => {
        assert.ok(err instanceof SchemaValidationError);
        assert.match(err.message, /unknown/i);
        return true;
      },
    );
  });

  it("ScreeningOutput rejects unknown top-level key", () => {
    const input = { ...VALID_SCREENING_OUTPUT, extra_field: "oops" };
    assert.throws(
      () => parseScreeningOutput(input),
      (err: unknown) => {
        assert.ok(err instanceof SchemaValidationError);
        assert.match(err.message, /unknown/i);
        return true;
      },
    );
  });

  it("InterviewKitOutput rejects unknown top-level key", () => {
    const input = { ...VALID_INTERVIEW_KIT_OUTPUT, extra_field: "oops" };
    assert.throws(
      () => parseInterviewKitOutput(input),
      (err: unknown) => {
        assert.ok(err instanceof SchemaValidationError);
        assert.match(err.message, /unknown/i);
        return true;
      },
    );
  });
});

describe("schema parse — nested forbidden keys in facts", () => {
  it("rejects reasoning_chain inside a fact", () => {
    const input = {
      ...VALID_RESUME_OUTPUT,
      facts: [
        { ...VALID_RESUME_OUTPUT.facts[0], reasoning_chain: "I thought about..." },
      ],
    };
    assert.throws(
      () => parseResumeParserOutput(input),
      (err: unknown) => {
        assert.ok(err instanceof SchemaValidationError);
        assert.match(err.message, /forbidden/i);
        return true;
      },
    );
  });
});

describe("schema parse — nested forbidden keys in dimensionRating", () => {
  it("rejects raw_prompt inside a dimensionRating", () => {
    const input = {
      ...VALID_SCREENING_OUTPUT,
      dimensionRatings: [
        { ...VALID_SCREENING_OUTPUT.dimensionRatings[0], raw_prompt: "full prompt here" },
      ],
    };
    assert.throws(
      () => parseScreeningOutput(input),
      (err: unknown) => {
        assert.ok(err instanceof SchemaValidationError);
        assert.match(err.message, /forbidden/i);
        return true;
      },
    );
  });
});

describe("schema parse — type errors", () => {
  it("rejects non-object input", () => {
    assert.throws(() => parseResumeParserOutput("string"), SchemaValidationError);
    assert.throws(() => parseScreeningOutput(42), SchemaValidationError);
    assert.throws(() => parseInterviewKitOutput(null), SchemaValidationError);
  });

  it("rejects invalid recommendation value", () => {
    const input = { ...VALID_SCREENING_OUTPUT, recommendation: "excellent" };
    assert.throws(() => parseScreeningOutput(input), SchemaValidationError);
  });

  it("rejects invalid parseStatus", () => {
    const input = { ...VALID_RESUME_OUTPUT, parseStatus: "done" };
    assert.throws(() => parseResumeParserOutput(input), SchemaValidationError);
  });
});

describe("schema parse — talentPoolSignal normalization", () => {
  it("normalizes missing talentPoolSignal to null", () => {
    const input = {
      recommendation: "strong_match",
      dimensionRatings: [
        { dimension: "skills", rating: "strong", reason: "Matches JD", evidenceRefs: ["f1"] },
      ],
      fairnessFlags: [],
    };
    const result = parseScreeningOutput(input);
    assert.strictEqual(result.talentPoolSignal, null);
  });

  it("normalizes undefined talentPoolSignal to null", () => {
    const input = {
      recommendation: "strong_match",
      dimensionRatings: [],
      fairnessFlags: [],
      talentPoolSignal: undefined,
    };
    const result = parseScreeningOutput(input);
    assert.strictEqual(result.talentPoolSignal, null);
  });

  it("preserves explicit null talentPoolSignal", () => {
    const result = parseScreeningOutput(VALID_SCREENING_OUTPUT);
    assert.strictEqual(result.talentPoolSignal, null);
  });

  it("preserves string talentPoolSignal", () => {
    const input = {
      ...VALID_SCREENING_OUTPUT,
      talentPoolSignal: "Strong technical skills, consider for future roles",
    };
    const result = parseScreeningOutput(input);
    assert.equal(result.talentPoolSignal, "Strong technical skills, consider for future roles");
  });
});

describe("schema parse — sourceExcerpt normalization", () => {
  it("normalizes missing sourceExcerpt in fact to null", () => {
    const input = {
      facts: [
        { factType: "skill", factText: "TypeScript", confidence: "high" },
      ],
      parseStatus: "success",
    };
    const result = parseResumeParserOutput(input);
    assert.strictEqual(result.facts[0]!.sourceExcerpt, null);
  });

  it("normalizes null sourceExcerpt in fact", () => {
    const input = {
      facts: [
        { factType: "skill", factText: "TypeScript", sourceExcerpt: null, confidence: "high" },
      ],
      parseStatus: "success",
    };
    const result = parseResumeParserOutput(input);
    assert.strictEqual(result.facts[0]!.sourceExcerpt, null);
  });

  it("preserves string sourceExcerpt in fact", () => {
    const result = parseResumeParserOutput(VALID_RESUME_OUTPUT);
    assert.equal(result.facts[0]!.sourceExcerpt, "3 years TypeScript");
  });

  it("rejects non-string non-null sourceExcerpt", () => {
    const input = {
      facts: [
        { factType: "skill", factText: "TypeScript", sourceExcerpt: 123, confidence: "high" },
      ],
      parseStatus: "success",
    };
    assert.throws(() => parseResumeParserOutput(input), SchemaValidationError);
  });
});

describe("schema parse — AnalyticsOutput", () => {
  const VALID_ANALYTICS_OUTPUT = {
    funnelSummary: "8 candidates entered pipeline",
    qualitySummary: "Strong technical depth",
    bottlenecks: ["Screening drop-off"],
    talentPoolSuggestions: ["Consider for future roles"],
    recommendations: ["Add communication assessment"],
  };

  it("parses valid AnalyticsOutput", () => {
    const result = parseAnalyticsOutput(VALID_ANALYTICS_OUTPUT);
    assert.equal(result.funnelSummary, "8 candidates entered pipeline");
    assert.equal(result.bottlenecks.length, 1);
  });

  it("rejects unknown key", () => {
    const input = { ...VALID_ANALYTICS_OUTPUT, extra_field: "oops" };
    assert.throws(
      () => parseAnalyticsOutput(input),
      (err: unknown) => {
        assert.ok(err instanceof SchemaValidationError);
        assert.match(err.message, /unknown/i);
        return true;
      },
    );
  });

  it("rejects forbidden key", () => {
    const input = { ...VALID_ANALYTICS_OUTPUT, thinking: "secret" };
    assert.throws(
      () => parseAnalyticsOutput(input),
      (err: unknown) => {
        assert.ok(err instanceof SchemaValidationError);
        assert.match(err.message, /forbidden/i);
        return true;
      },
    );
  });

  it("rejects wrong type for bottlenecks", () => {
    const input = { ...VALID_ANALYTICS_OUTPUT, bottlenecks: "not_array" };
    assert.throws(() => parseAnalyticsOutput(input), SchemaValidationError);
  });

  it("rejects wrong type for funnelSummary", () => {
    const input = { ...VALID_ANALYTICS_OUTPUT, funnelSummary: 123 };
    assert.throws(() => parseAnalyticsOutput(input), SchemaValidationError);
  });

  it("rejects non-object input", () => {
    assert.throws(() => parseAnalyticsOutput("string"), SchemaValidationError);
  });
});
