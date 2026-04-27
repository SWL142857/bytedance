import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  loadJsonInput,
  parseCandidatePipelineInputValue,
  parseResumeParserInputValue,
} from "../../src/runtime/agent-input.js";

describe("agent-input", () => {
  it("parses resume parser input from plain object", () => {
    const parsed = parseResumeParserInputValue({
      candidateRecordId: "recCandidate001",
      candidateId: "cand_001",
      resumeText: "Resume text",
      fromStatus: "new",
    });

    assert.equal(parsed.candidateRecordId, "recCandidate001");
    assert.equal(parsed.fromStatus, "new");
  });

  it("parses candidate pipeline input from plain object", () => {
    const parsed = parseCandidatePipelineInputValue({
      candidateRecordId: "recCandidate001",
      jobRecordId: "recJob001",
      candidateId: "cand_001",
      jobId: "job_001",
      resumeText: "Resume text",
      jobRequirements: "Requirements",
      jobRubric: "Rubric",
    });

    assert.equal(parsed.jobRecordId, "recJob001");
    assert.equal(parsed.jobRubric, "Rubric");
  });

  it("rejects invalid Resume Parser fromStatus", () => {
    assert.throws(
      () =>
        parseResumeParserInputValue({
          candidateRecordId: "recCandidate001",
          candidateId: "cand_001",
          resumeText: "Resume text",
          fromStatus: "parsed",
        }),
      /fromStatus/,
    );
  });

  it("rejects missing candidate pipeline fields", () => {
    assert.throws(
      () =>
        parseCandidatePipelineInputValue({
          candidateRecordId: "recCandidate001",
        }),
      /jobRecordId/,
    );
  });

  it("only allows one input source", () => {
    assert.throws(
      () =>
        loadJsonInput({
          inputFile: "/tmp/input.json",
          inputJson: "{\"ok\":true}",
        }),
      /Only one input source/,
    );
  });
});
