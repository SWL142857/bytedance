import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadAgentInputBundles } from "../../src/runtime/bundle-loader.js";
import { agentInputBundleToPipelineInput } from "../../src/runtime/bundle-loader.js";
import { verifyBundles } from "../../src/runtime/rag-dataset-verification.js";
import type { AgentInputBundle, BundleLoadResult } from "../../src/runtime/bundle-loader.js";

function makeValidEntry(overrides?: Record<string, unknown>) {
  return {
    candidate: { candidateRecordId: "rec_001", candidateId: "c001", resumeText: "Resume." },
    job: { jobRecordId: "rec_j001", jobId: "j001", requirements: "Req", rubric: "Rub" },
    evidence: [
      { sourceRef: "dataset:ds1:0", kind: "resume", usedFor: "screening", snippet: "Evidence.", score: 0.8 },
    ],
    ...overrides,
  };
}

function emptyResult(): BundleLoadResult {
  return { bundles: [], totalCount: 0, errorCount: 0, errors: [] };
}

// ═══════════════════════════════════════════════════
// Status rules
// ═══════════════════════════════════════════════════

describe("rag-dataset-verification — status rules", () => {
  it("all candidates with evidence → passed", () => {
    const result = loadAgentInputBundles({
      inputJson: JSON.stringify([makeValidEntry(), makeValidEntry({ candidate: { candidateRecordId: "rec_002", candidateId: "c002", resumeText: "R2." } })]),
    });
    const report = verifyBundles(result);
    assert.equal(report.status, "passed");
    assert.equal(report.totalCandidates, 2);
    assert.equal(report.completed, 2);
    assert.equal(report.failed, 0);
    assert.equal(report.evidenceCoverage.withEvidence, 2);
    assert.equal(report.evidenceCoverage.withoutEvidence, 0);
  });

  it("some without evidence → needs_review", () => {
    const result = loadAgentInputBundles({
      inputJson: JSON.stringify([
        makeValidEntry(),
        { ...makeValidEntry(), candidate: { candidateRecordId: "rec_002", candidateId: "c002", resumeText: "R2." }, evidence: [] },
      ]),
    });
    const report = verifyBundles(result);
    assert.equal(report.status, "needs_review");
    assert.equal(report.evidenceCoverage.withEvidence, 1);
    assert.equal(report.evidenceCoverage.withoutEvidence, 1);
  });

  it("blocked snippet → needs_review + redactionBlockedCount", () => {
    const result = loadAgentInputBundles({
      inputJson: JSON.stringify([makeValidEntry({
        evidence: [{ sourceRef: "dataset:ds1:0", kind: "note", usedFor: "display", snippet: "Contains rec_secret_001 leak." }],
      })]),
    });
    const report = verifyBundles(result);
    assert.equal(report.status, "needs_review");
    assert.ok(report.redactionBlockedCount >= 1);
  });

  it("blocked evidence does not count as usable coverage", () => {
    const result = loadAgentInputBundles({
      inputJson: JSON.stringify([makeValidEntry({
        evidence: [{ sourceRef: "dataset:ds1:0", kind: "note", usedFor: "display", snippet: "Contains rec_secret_001 leak." }],
      })]),
    });
    const report = verifyBundles(result);
    assert.equal(report.evidenceCoverage.withEvidence, 0);
    assert.equal(report.evidenceCoverage.withoutEvidence, 1);
    assert.deepEqual(report.evidenceUsage, []);
  });

  it("mixed clean and blocked evidence keeps only clean evidence usable", () => {
    const result = loadAgentInputBundles({
      inputJson: JSON.stringify([makeValidEntry({
        evidence: [
          { sourceRef: "dataset:ds1:0", kind: "note", usedFor: "display", snippet: "Contains rec_secret_001 leak." },
          { sourceRef: "dataset:ds1:1", kind: "resume", usedFor: "screening", snippet: "Clean evidence." },
        ],
      })]),
    });
    const report = verifyBundles(result);
    assert.equal(report.evidenceCoverage.withEvidence, 1);
    assert.equal(report.evidenceCoverage.withoutEvidence, 0);
    assert.deepEqual(report.evidenceUsage, [{ agent: "screening", evidenceCount: 1 }]);
  });

  it("provider blocked → needs_review + providerBlockedCount", () => {
    const result = loadAgentInputBundles({
      inputJson: JSON.stringify([makeValidEntry()]),
    });
    // Override bundle to simulate provider mode with blocked guard
    result.bundles[0] = {
      ...result.bundles[0]!,
      runMode: "provider",
      guardFlags: { allowProvider: false, allowWrites: false, evidenceMayEnterPrompt: false },
    } as AgentInputBundle;
    const report = verifyBundles(result, true);
    assert.equal(report.status, "needs_review");
    assert.ok(report.providerBlockedCount >= 1);
    assert.equal(report.guardrailSummary.providerAllowed, true);
  });

  it("all bundles invalid → failed", () => {
    const result = loadAgentInputBundles({
      inputJson: JSON.stringify([
        { candidate: { candidateRecordId: "rec_001" } },
      ]),
    });
    const report = verifyBundles(result);
    assert.equal(report.status, "failed");
    assert.equal(report.completed, 0);
    assert.equal(report.failed, 1);
  });

  it("empty input → failed", () => {
    const report = verifyBundles(emptyResult());
    assert.equal(report.status, "failed");
    assert.equal(report.totalCandidates, 0);
    assert.ok(report.safeSummary.includes("没有有效的候选人数据"));
  });
});

// ═══════════════════════════════════════════════════
// Evidence usage
// ═══════════════════════════════════════════════════

describe("rag-dataset-verification — evidenceUsage", () => {
  it("maps usedFor to agent names", () => {
    const result = loadAgentInputBundles({
      inputJson: JSON.stringify([makeValidEntry({
        evidence: [
          { sourceRef: "dataset:ds1:0", kind: "resume", usedFor: "screening", snippet: "Ev1." },
          { sourceRef: "dataset:ds1:1", kind: "interview", usedFor: "interview_kit", snippet: "Ev2." },
          { sourceRef: "dataset:ds1:2", kind: "note", usedFor: "hr_review", snippet: "Ev3." },
          { sourceRef: "dataset:ds1:3", kind: "other", usedFor: "verification", snippet: "Ev4." },
        ],
      })]),
    });
    const report = verifyBundles(result);

    const usageMap: Record<string, number> = {};
    for (const u of report.evidenceUsage) {
      usageMap[u.agent] = u.evidenceCount;
    }
    assert.equal(usageMap.screening, 1);
    assert.equal(usageMap.interview_kit, 1);
    assert.equal(usageMap.hr_coordinator, 1);
    assert.equal(usageMap.verification, 1);
  });

  it("display usedFor → verification agent", () => {
    const result = loadAgentInputBundles({
      inputJson: JSON.stringify([makeValidEntry({
        evidence: [{ sourceRef: "dataset:ds1:0", kind: "note", usedFor: "display", snippet: "Display only." }],
      })]),
    });
    const report = verifyBundles(result);
    const v = report.evidenceUsage.find((u) => u.agent === "verification");
    assert.ok(v);
    assert.equal(v!.evidenceCount, 1);
  });
});

// ═══════════════════════════════════════════════════
// Schema errors
// ═══════════════════════════════════════════════════

describe("rag-dataset-verification — schemaErrors", () => {
  it("aggregates schema errors by field", () => {
    const result = loadAgentInputBundles({
      inputJson: JSON.stringify([
        makeValidEntry(),
        { candidate: { candidateRecordId: "rec_002" } },
        { candidate: { candidateId: "c003" } },
      ]),
    });
    const report = verifyBundles(result);
    // Two schema errors — both missing required fields
    assert.ok(report.schemaErrors.length >= 1);
    const totalSchemaErrors = report.schemaErrors.reduce((sum, e) => sum + e.count, 0);
    assert.equal(totalSchemaErrors, 2);
  });

  it("sanitizes schema error fields from arbitrary upstream errors", () => {
    const report = verifyBundles({
      bundles: [],
      totalCount: 3,
      errorCount: 3,
      errors: [
        'Bundle 0: field "apiKey" must be a string.',
        'Bundle 1: field "/tmp/secret.json" must be a string.',
        'Bundle 2: field "resumeText" must be a string.',
      ],
    });
    assert.deepEqual(report.schemaErrors, [
      { field: "unknown", count: 2 },
      { field: "resumeText", count: 1 },
    ]);
    const json = JSON.stringify(report);
    assert.ok(!json.includes("apiKey"));
    assert.ok(!json.includes("/tmp/secret.json"));
  });
});

// ═══════════════════════════════════════════════════
// Safety: no leaks
// ═══════════════════════════════════════════════════

describe("rag-dataset-verification — safety", () => {
  it("report does not leak resumeText", () => {
    const result = loadAgentInputBundles({
      inputJson: JSON.stringify([makeValidEntry()]),
    });
    const report = verifyBundles(result);
    const json = JSON.stringify(report);
    assert.ok(!json.includes("AI Product Manager"), "Must not leak resume text");
    assert.ok(!json.includes("Resume."), "Must not leak resume text");
  });

  it("report does not leak record IDs", () => {
    const result = loadAgentInputBundles({
      inputJson: JSON.stringify([makeValidEntry()]),
    });
    const report = verifyBundles(result);
    const json = JSON.stringify(report);
    assert.ok(!json.includes("rec_001"), "Must not leak candidate record ID");
    assert.ok(!json.includes("rec_j001"), "Must not leak job record ID");
  });

  it("report does not leak payload, prompt, apiKey, endpoint, modelId", () => {
    const result = loadAgentInputBundles({
      inputJson: JSON.stringify([makeValidEntry()]),
    });
    const report = verifyBundles(result);
    const json = JSON.stringify(report);
    const forbidden = ["payload", "prompt", "apiKey", "endpoint", "modelId", "stdout", "stderr"];
    for (const f of forbidden) {
      assert.ok(!json.includes(f), `Report must not contain: "${f}"`);
    }
  });

  it("safeSummary is fixed Chinese text, not raw error concatenation", () => {
    const result = loadAgentInputBundles({
      inputJson: JSON.stringify([makeValidEntry()]),
    });
    const report = verifyBundles(result);
    assert.ok(report.safeSummary.length > 0);
    // Safe summary should not contain raw technical terms in English
    assert.ok(!report.safeSummary.includes("Error:"), "safeSummary must not contain raw error text");
    assert.ok(!report.safeSummary.includes("null"), "safeSummary must not contain null");
  });

  it("blocked evidence snippet content not in report", () => {
    const result = loadAgentInputBundles({
      inputJson: JSON.stringify([makeValidEntry({
        evidence: [{ sourceRef: "dataset:ds1:0", kind: "note", usedFor: "display",
          snippet: "Secret: apiKey=sk-abc123" }],
      })]),
    });
    const report = verifyBundles(result);
    const json = JSON.stringify(report);
    assert.ok(!json.includes("sk-abc123"), "Must not leak blocked snippet content");
    assert.ok(!json.includes("apiKey="), "Must not leak blocked snippet content");
  });

  it("sourceRefs do not appear in report (aggregate only)", () => {
    const result = loadAgentInputBundles({
      inputJson: JSON.stringify([makeValidEntry()]),
    });
    const report = verifyBundles(result);
    const json = JSON.stringify(report);
    assert.ok(!json.includes("dataset:ds1:0"), "Must not leak individual sourceRef in report");
  });

  it("report does not contain local file paths", () => {
    const result = loadAgentInputBundles({
      inputJson: JSON.stringify([makeValidEntry()]),
    });
    const report = verifyBundles(result);
    const json = JSON.stringify(report);
    assert.ok(!json.includes("/tmp/"), "Must not contain file paths");
    assert.ok(!json.includes("/Users/"), "Must not contain file paths");
  });

  it("malicious schema error field names are mapped to unknown", () => {
    // Simulate a result with errors containing unsafe field names
    const result = loadAgentInputBundles({
      inputJson: JSON.stringify([
        makeValidEntry(),
        { candidate: { candidateId: "c2", resumeText: "R2" } },  // missing candidateRecordId
      ]),
    });
    const report = verifyBundles(result);
    // Schema errors should only contain whitelisted field names or "unknown"
    for (const se of report.schemaErrors) {
      assert.ok(
        se.field === "unknown" || [
          "candidate", "candidateRecordId", "candidateId", "resumeText",
          "job", "jobRecordId", "jobId", "requirements", "rubric",
          "evidence", "sourceRef", "kind", "usedFor", "snippet", "score",
        ].includes(se.field),
        `schemaErrors.field must be safe, got: "${se.field}"`,
      );
    }
  });

  it("report JSON does not contain EXECUTE tokens or write paths", () => {
    const result = loadAgentInputBundles({
      inputJson: JSON.stringify([makeValidEntry()]),
    });
    const report = verifyBundles(result);
    const json = JSON.stringify(report);
    assert.ok(!json.includes("EXECUTE_LIVE"), "Must not contain execute tokens");
    assert.ok(!json.includes("execute-writes"), "Must not contain write paths");
  });
});

// ═══════════════════════════════════════════════════
// Adapter boundary
// ═══════════════════════════════════════════════════

describe("rag-dataset-verification — adapter boundary", () => {
  it("adapter does not put evidence into CandidatePipelineInput", () => {
    const bundle: AgentInputBundle = {
      candidate: { candidateRecordId: "rec_001", candidateId: "c001", resumeText: "Original." },
      job: { jobRecordId: "rec_j001", jobId: "j001", requirements: "R", rubric: "B" },
      evidence: [{ sourceRef: "dataset:d:0", kind: "resume", usedFor: "screening", snippet: "Extra.", redactionStatus: "clean" }],
      provenance: { inputSource: "json" as const, evidenceSource: "jsonl" as const, generatedAt: new Date().toISOString() },
      runMode: "deterministic" as const,
      guardFlags: { allowProvider: false as const, allowWrites: false as const, evidenceMayEnterPrompt: false as const },
    };
    const input = agentInputBundleToPipelineInput(bundle);
    assert.equal(input.resumeText, "Original.");
    assert.ok(!input.resumeText.includes("Extra."));
  });
});

// ═══════════════════════════════════════════════════
// Old compatibility
// ═══════════════════════════════════════════════════

describe("rag-dataset-verification — old compatibility", () => {
  it("bundle-loader tests still pass via loader", () => {
    const result = loadAgentInputBundles({
      inputJson: JSON.stringify([makeValidEntry()]),
    });
    assert.equal(result.totalCount, 1);
    assert.equal(result.errorCount, 0);
  });
});
