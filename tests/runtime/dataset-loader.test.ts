import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadDataset } from "../../src/runtime/dataset-loader.js";

describe("loadDataset", () => {
  const validEntry = {
    candidateRecordId: "rec_001",
    jobRecordId: "rec_j001",
    candidateId: "c001",
    jobId: "j001",
    resumeText: "Python developer",
    jobRequirements: "5 years Python",
    jobRubric: "Technical: 60%",
  };

  it("parses valid JSON array", () => {
    const result = loadDataset({
      inputJson: JSON.stringify([validEntry]),
    });
    assert.equal(result.totalCount, 1);
    assert.equal(result.errorCount, 0);
    assert.equal(result.inputs.length, 1);
    assert.equal(result.inputs[0]!.candidateId, "c001");
  });

  it("parses valid JSONL", () => {
    const jsonl = JSON.stringify(validEntry) + "\n" + JSON.stringify({ ...validEntry, candidateId: "c002" });
    const result = loadDataset({ inputJson: jsonl });
    assert.equal(result.totalCount, 2);
    assert.equal(result.inputs.length, 2);
    assert.equal(result.errorCount, 0);
  });

  it("collects safe errors for missing fields", () => {
    const result = loadDataset({
      inputJson: JSON.stringify([validEntry, { candidateRecordId: "x" }]),
    });
    assert.equal(result.totalCount, 2);
    assert.equal(result.inputs.length, 1);
    assert.equal(result.errorCount, 1);
    assert.ok(result.errors[0]!.includes("Entry 1"));
  });

  it("throws when all entries fail", () => {
    assert.throws(
      () => loadDataset({ inputJson: JSON.stringify([{ bad: true }]) }),
      /All 1 entries failed/,
    );
  });

  it("throws for malformed JSON", () => {
    assert.throws(
      () => loadDataset({ inputJson: "not-json" }),
    );
  });

  it("throws when no source provided", () => {
    assert.throws(
      () => loadDataset({}),
      /Dataset input is required/,
    );
  });

  it("throws when both sources provided", () => {
    assert.throws(
      () => loadDataset({ inputFile: "a.json", inputJson: "[]" }),
      /Only one input source/,
    );
  });

  it("throws for empty array", () => {
    assert.throws(
      () => loadDataset({ inputJson: "[]" }),
      /non-empty/,
    );
  });

  it("does not leak sensitive text in errors", () => {
    const sensitive = { candidateRecordId: "rec_secret_001" };
    assert.throws(
      () => loadDataset({ inputJson: JSON.stringify([sensitive]) }),
    );
    // If it doesn't throw (partial failure), check error messages
    try {
      loadDataset({ inputJson: JSON.stringify([validEntry, sensitive]) });
    } catch {
      return; // threw, which is fine
    }
    // If it didn't throw, errors should not contain the sensitive value
    const result = loadDataset({ inputJson: JSON.stringify([validEntry, { candidateRecordId: "rec_secret_001" }]) });
    for (const err of result.errors) {
      assert.ok(!err.includes("rec_secret_001"), `Error leaked sensitive text: ${err}`);
    }
  });
});
