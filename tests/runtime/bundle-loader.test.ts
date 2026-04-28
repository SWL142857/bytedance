import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadDataset } from "../../src/runtime/dataset-loader.js";
import {
  loadAgentInputBundles,
  agentInputBundleToPipelineInput,
  isValidSourceRef,
  cleanEvidenceSnippet,
  computeEvidenceHash,
} from "../../src/runtime/bundle-loader.js";
import type { AgentInputBundle, RetrievedEvidence } from "../../src/runtime/bundle-loader.js";

// ── Shared fixtures ──

const validBundleEntry = {
  candidate: {
    candidateRecordId: "rec_cand_001",
    candidateId: "cand_001",
    resumeText: "AI Product Manager with 6 years experience.",
  },
  job: {
    jobRecordId: "rec_job_001",
    jobId: "job_ai_pm",
    requirements: "5+ years PM, AI products, data-driven.",
    rubric: "technical depth, product sense, communication",
  },
};

function makeValidBundle(overrides?: Partial<AgentInputBundle>): AgentInputBundle {
  return {
    candidate: { candidateRecordId: "rec_001", candidateId: "c001", resumeText: "Test resume." },
    job: { jobRecordId: "rec_j001", jobId: "j001", requirements: "Req", rubric: "Rub" },
    evidence: [],
    provenance: { inputSource: "json", evidenceSource: "none", generatedAt: new Date().toISOString() },
    runMode: "deterministic",
    guardFlags: { allowProvider: false, allowWrites: false, evidenceMayEnterPrompt: false },
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════
// Old compatibility
// ═══════════════════════════════════════════════════

describe("bundle-loader — old compatibility", () => {
  it("loadDataset still works with valid JSON array", () => {
    const result = loadDataset({
      inputJson: JSON.stringify([{
        candidateRecordId: "rec_001",
        jobRecordId: "rec_j001",
        candidateId: "c001",
        jobId: "j001",
        resumeText: "Resume.",
        jobRequirements: "Req",
        jobRubric: "Rub",
      }]),
    });
    assert.equal(result.totalCount, 1);
    assert.equal(result.inputs.length, 1);
  });

  it("loadDataset still works with valid JSONL", () => {
    const jsonl = [
      { candidateRecordId: "r1", jobRecordId: "rj1", candidateId: "c1", jobId: "j1", resumeText: "R1", jobRequirements: "Q1", jobRubric: "B1" },
      { candidateRecordId: "r2", jobRecordId: "rj2", candidateId: "c2", jobId: "j2", resumeText: "R2", jobRequirements: "Q2", jobRubric: "B2" },
    ].map((entry) => JSON.stringify(entry)).join("\n");
    const result = loadDataset({ inputJson: jsonl });
    assert.equal(result.totalCount, 2);
    assert.equal(result.errorCount, 0);
  });
});

// ═══════════════════════════════════════════════════
// AgentInputBundle loading
// ═══════════════════════════════════════════════════

describe("bundle-loader — AgentInputBundle loading", () => {
  it("loads valid JSON array with embedded evidence", () => {
    const entry = {
      candidate: { candidateRecordId: "rec_001", candidateId: "c001", resumeText: "Resume." },
      job: { jobRecordId: "rec_j001", jobId: "j001", requirements: "Req", rubric: "Rub" },
      evidence: [
        { sourceRef: "dataset:ds1:0", kind: "resume", usedFor: "screening", snippet: "Evidence text.", score: 0.85 },
      ],
    };
    const result = loadAgentInputBundles({ inputJson: JSON.stringify([entry]) });
    assert.equal(result.totalCount, 1);
    assert.equal(result.errorCount, 0);
    assert.equal(result.bundles.length, 1);
    assert.equal(result.bundles[0]!.provenance.inputSource, "json");
    assert.equal(result.bundles[0]!.evidence.length, 1);
    assert.equal(result.bundles[0]!.evidence[0]!.sourceRef, "dataset:ds1:0");
    assert.equal(result.bundles[0]!.evidence[0]!.redactionStatus, "clean");
    assert.equal(result.bundles[0]!.guardFlags.allowWrites, false);
  });

  it("loads valid JSONL with embedded evidence", () => {
    const entry = {
      candidate: { candidateRecordId: "rec_001", candidateId: "c001", resumeText: "R." },
      job: { jobRecordId: "rec_j001", jobId: "j001", requirements: "Q", rubric: "B" },
      evidence: [{ sourceRef: "note:n1", kind: "note", usedFor: "display" }],
    };
    const jsonl = [entry, { ...entry, candidate: { ...entry.candidate, candidateId: "c002" } }]
      .map((item) => JSON.stringify(item)).join("\n");
    const result = loadAgentInputBundles({ inputJson: jsonl });
    assert.equal(result.totalCount, 2);
    assert.equal(result.bundles.length, 2);
    assert.equal(result.bundles[0]!.provenance.inputSource, "jsonl");
  });

  it("handles empty evidence array", () => {
    const entry = {
      candidate: { candidateRecordId: "rec_001", candidateId: "c001", resumeText: "R." },
      job: { jobRecordId: "rec_j001", jobId: "j001", requirements: "Q", rubric: "B" },
      evidence: [],
    };
    const result = loadAgentInputBundles({ inputJson: JSON.stringify([entry]) });
    assert.equal(result.bundles[0]!.evidence.length, 0);
  });

  it("handles missing evidence field (defaults to [])", () => {
    const entry = { ...validBundleEntry };
    const result = loadAgentInputBundles({ inputJson: JSON.stringify([entry]) });
    assert.equal(result.bundles[0]!.evidence.length, 0);
  });

  it("loads evidence pool + mapping from envelope format", () => {
    const envelope = {
      candidates: [
        {
          candidate: { candidateRecordId: "rec_001", candidateId: "c001", resumeText: "R." },
          job: { jobRecordId: "rec_j001", jobId: "j001", requirements: "Q", rubric: "B" },
          evidenceIds: ["dataset:pool:0"],
        },
      ],
      evidencePool: [
        { sourceRef: "dataset:pool:0", kind: "resume", usedFor: "screening", snippet: "Pool evidence." },
      ],
    };
    const result = loadAgentInputBundles({ inputJson: JSON.stringify([envelope]) });
    assert.equal(result.totalCount, 1);
    assert.equal(result.bundles[0]!.evidence.length, 1);
    assert.equal(result.bundles[0]!.evidence[0]!.sourceRef, "dataset:pool:0");
  });
});

// ═══════════════════════════════════════════════════
// SourceRef validation
// ═══════════════════════════════════════════════════

describe("bundle-loader — sourceRef validation", () => {
  it("accepts dataset: prefix", () => {
    assert.ok(isValidSourceRef("dataset:myDataset:0"));
  });

  it("accepts note: prefix", () => {
    assert.ok(isValidSourceRef("note:myNoteId"));
  });

  it("accepts base: prefix", () => {
    assert.ok(isValidSourceRef("base:candidates:resume_text"));
  });

  it("rejects empty sourceRef", () => {
    assert.equal(isValidSourceRef(""), false);
  });

  it("rejects sourceRef without allowed prefix", () => {
    assert.equal(isValidSourceRef("/tmp/evidence.txt"), false);
    assert.equal(isValidSourceRef("http://example.com"), false);
    assert.equal(isValidSourceRef("rec_secret_001"), false);
  });

  it("rejects sourceRef with allowed prefix but unsafe internal value", () => {
    assert.equal(isValidSourceRef("dataset:rec_secret_001:0"), false);
    assert.equal(isValidSourceRef("dataset:/tmp/secret:0"), false);
    assert.equal(isValidSourceRef("dataset:ds1:notNumber"), false);
    assert.equal(isValidSourceRef("note:http://example.com"), false);
    assert.equal(isValidSourceRef("base:candidates:record_id"), false);
  });

  it("rejects evidence with invalid sourceRef in loader", () => {
    const entry = {
      candidate: { candidateRecordId: "rec_001", candidateId: "c001", resumeText: "R." },
      job: { jobRecordId: "rec_j001", jobId: "j001", requirements: "Q", rubric: "B" },
      evidence: [{ sourceRef: "/tmp/secret.txt", kind: "note", usedFor: "display" }],
    };
    const result = loadAgentInputBundles({ inputJson: JSON.stringify([entry]) });
    assert.equal(result.bundles[0]!.evidence.length, 0);
  });

  it("rejects evidence with prefixed but sensitive sourceRef in loader", () => {
    const entry = {
      candidate: { candidateRecordId: "rec_001", candidateId: "c001", resumeText: "R." },
      job: { jobRecordId: "rec_j001", jobId: "j001", requirements: "Q", rubric: "B" },
      evidence: [{ sourceRef: "dataset:rec_secret_001:0", kind: "note", usedFor: "display" }],
    };
    const result = loadAgentInputBundles({ inputJson: JSON.stringify([entry]) });
    assert.equal(result.bundles[0]!.evidence.length, 0);
  });
});

// ═══════════════════════════════════════════════════
// Snippet cleaning
// ═══════════════════════════════════════════════════

describe("bundle-loader — snippet cleaning", () => {
  it("cleans a short snippet → clean", () => {
    const result = cleanEvidenceSnippet("Short text here.");
    assert.equal(result.status, "clean");
    assert.equal(result.text, "Short text here.");
  });

  it("truncates snippet >500 chars", () => {
    const longText = "x".repeat(600);
    const result = cleanEvidenceSnippet(longText);
    assert.equal(result.status, "truncated");
    assert.ok(result.text.endsWith("[已截断]"));
    assert.ok(result.text.length <= 500 + "[已截断]".length);
  });

  it("blocks snippet containing sensitive pattern", () => {
    const result = cleanEvidenceSnippet("Contains rec_secret_001 pattern.");
    assert.equal(result.status, "blocked");
    assert.equal(result.text, "");
  });

  it("handles null/undefined snippet → clean with empty text", () => {
    assert.equal(cleanEvidenceSnippet(null).status, "clean");
    assert.equal(cleanEvidenceSnippet(undefined).status, "clean");
    assert.equal(cleanEvidenceSnippet(null).text, "");
  });

  it("blocks evidence with sensitive snippet in loader", () => {
    const entry = {
      candidate: { candidateRecordId: "rec_001", candidateId: "c001", resumeText: "R." },
      job: { jobRecordId: "rec_j001", jobId: "j001", requirements: "Q", rubric: "B" },
      evidence: [{ sourceRef: "dataset:ds1:0", kind: "note", usedFor: "display",
        snippet: "Includes rec_sensitive_data leak." }],
    };
    const result = loadAgentInputBundles({ inputJson: JSON.stringify([entry]) });
    const ev = result.bundles[0]!.evidence[0]!;
    assert.equal(ev.redactionStatus, "blocked");
    assert.equal(ev.snippet, undefined);
  });
});

// ═══════════════════════════════════════════════════
// Evidence hash
// ═══════════════════════════════════════════════════

describe("bundle-loader — evidence hash", () => {
  it("produces deterministic hash", () => {
    const ev: RetrievedEvidence[] = [
      { sourceRef: "dataset:d:0", kind: "resume", usedFor: "screening", redactionStatus: "clean" },
    ];
    const h1 = computeEvidenceHash(ev);
    const h2 = computeEvidenceHash(ev);
    assert.equal(h1, h2);
  });

  it("changes hash with different evidence content", () => {
    const ev1: RetrievedEvidence[] = [
      { sourceRef: "dataset:d:0", kind: "resume", usedFor: "screening", redactionStatus: "clean" },
    ];
    const ev2: RetrievedEvidence[] = [
      { sourceRef: "dataset:d:0", kind: "job", usedFor: "screening", redactionStatus: "clean" },
    ];
    assert.notEqual(computeEvidenceHash(ev1), computeEvidenceHash(ev2));
  });

  it("changes hash with different snippet", () => {
    const ev1: RetrievedEvidence[] = [
      { sourceRef: "dataset:d:0", kind: "resume", usedFor: "screening", snippet: "A", redactionStatus: "clean" },
    ];
    const ev2: RetrievedEvidence[] = [
      { sourceRef: "dataset:d:0", kind: "resume", usedFor: "screening", snippet: "B", redactionStatus: "clean" },
    ];
    assert.notEqual(computeEvidenceHash(ev1), computeEvidenceHash(ev2));
  });
});

// ═══════════════════════════════════════════════════
// Adapter
// ═══════════════════════════════════════════════════

describe("bundle-loader — adapter", () => {
  it("maps bundle to CandidatePipelineInput", () => {
    const bundle = makeValidBundle({
      candidate: { candidateRecordId: "rec_001", candidateId: "c001", resumeText: "Resume text." },
      job: { jobRecordId: "rec_j001", jobId: "j001", requirements: "Reqs", rubric: "Rubric" },
    });
    const input = agentInputBundleToPipelineInput(bundle);
    assert.equal(input.candidateRecordId, "rec_001");
    assert.equal(input.jobRecordId, "rec_j001");
    assert.equal(input.candidateId, "c001");
    assert.equal(input.resumeText, "Resume text.");
    assert.equal(input.jobRequirements, "Reqs");
    assert.equal(input.jobRubric, "Rubric");
  });

  it("adapter output does not contain evidence snippets", () => {
    const bundle = makeValidBundle();
    const input = agentInputBundleToPipelineInput(bundle);
    // The output is CandidatePipelineInput — no evidence field exists
    assert.ok(!Object.prototype.hasOwnProperty.call(input, "evidence"));
    // resumeText should be exactly what was in candidate.resumeText
    assert.equal(input.resumeText, "Test resume.");
  });

  it("adapter preserves original resumeText regardless of evidence", () => {
    const bundle = makeValidBundle({
      candidate: { candidateRecordId: "rec_001", candidateId: "c001", resumeText: "Original resume." },
      evidence: [
        { sourceRef: "dataset:d:0", kind: "resume", usedFor: "screening",
          snippet: "Extra evidence.", redactionStatus: "clean" },
      ],
    });
    const input = agentInputBundleToPipelineInput(bundle);
    assert.equal(input.resumeText, "Original resume.");
  });
});

// ═══════════════════════════════════════════════════
// Error safety
// ═══════════════════════════════════════════════════

describe("bundle-loader — error safety", () => {
  it("errors do not leak raw resume text", () => {
    const result = loadAgentInputBundles({
      inputJson: JSON.stringify([
        validBundleEntry,
        { candidate: { candidateRecordId: "rec_002" } },  // missing fields
      ]),
    });
    assert.equal(result.errorCount, 1);
    for (const err of result.errors) {
      assert.ok(!err.includes("AI Product Manager"), "Error must not leak resume text");
    }
  });

  it("errors do not leak record IDs or sensitive patterns", () => {
    const result = loadAgentInputBundles({
      inputJson: JSON.stringify([
        { candidate: { candidateId: "c1", resumeText: "rec_secret_001 leaked" } },
      ]),
    });
    for (const err of result.errors) {
      assert.ok(!err.includes("rec_secret_001"), "Error must not leak sensitive record ID");
      assert.ok(!err.includes("payload"), "Error must not mention payload");
      assert.ok(!err.includes("apiKey"), "Error must not mention apiKey");
      assert.ok(!err.includes("endpoint"), "Error must not mention endpoint");
    }
  });

  it("blocked evidence content not in errors", () => {
    const entry = {
      candidate: { candidateRecordId: "rec_001", candidateId: "c001", resumeText: "R." },
      job: { jobRecordId: "rec_j001", jobId: "j001", requirements: "Q", rubric: "B" },
      evidence: [{ sourceRef: "dataset:d:0", kind: "note", usedFor: "display",
        snippet: "apiKey: sk-secret-value-123" }],
    };
    const result = loadAgentInputBundles({ inputJson: JSON.stringify([entry]) });
    // Evidence should be blocked, not in errors
    const ev = result.bundles[0]!.evidence[0]!;
    assert.equal(ev.redactionStatus, "blocked");
    // Errors should not contain the blocked snippet content
    const errorsStr = result.errors.join(" ");
    assert.ok(!errorsStr.includes("sk-secret-value"), "Errors must not leak blocked snippet content");
  });

  it("throws for invalid JSON", () => {
    assert.throws(
      () => loadAgentInputBundles({ inputJson: "not-{json" }),
    );
  });

  it("throws for empty input", () => {
    assert.throws(
      () => loadAgentInputBundles({}),
      /Bundle input is required/,
    );
  });

  it("input file read errors do not leak local paths", () => {
    assert.throws(
      () => loadAgentInputBundles({ inputFile: "/tmp/rec_secret_001/missing.json" }),
      (err) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, "Failed to read input file.");
        assert.ok(!err.message.includes("/tmp"));
        assert.ok(!err.message.includes("rec_secret_001"));
        return true;
      },
    );
  });

  it("sourceMetadata is sanitized before returning bundles", () => {
    const entry = {
      candidate: {
        candidateRecordId: "rec_001",
        candidateId: "c001",
        resumeText: "R.",
        sourceMetadata: {
          batch: "safe batch",
          raw_path: "/tmp/secret.json",
          record: "rec_secret_001",
          nested: { bad: true },
        },
      },
      job: { jobRecordId: "rec_j001", jobId: "j001", requirements: "Q", rubric: "B" },
    };
    const result = loadAgentInputBundles({ inputJson: JSON.stringify([entry]) });
    assert.deepEqual(result.bundles[0]!.candidate.sourceMetadata, { batch: "safe batch" });
  });
});
