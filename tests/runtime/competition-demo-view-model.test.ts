import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildCompetitionDemoOverview,
  buildCompetitionSearchResult,
  buildCompetitionCandidateReview,
  sanitizeCompetitionText,
} from "../../src/runtime/competition-demo-view-model.js";

function makeFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "hireloop-vm-test-"));
  const memoryDir = join(root, "artifacts", "memory_graph");
  mkdirSync(memoryDir, { recursive: true });

  writeFileSync(
    join(memoryDir, "resumes.csv"),
    [
      "resume_id,candidate_id,job_id,raw_role,normalized_role,resume_text,job_description,source_dataset_row,ingest_status",
      "RES-000001,CAN-000001,JOB-ENG,Data Engineer,data engineer,Experienced Python developer with 5 years of data pipeline experience,Build data pipelines,1,ingested",
      "RES-000002,CAN-000002,JOB-ENG,Data Engineer,data engineer,Junior data analyst with SQL skills,Build data pipelines,2,ingested",
      "RES-000003,CAN-000003,JOB-PM,Product Manager,product manager,AI product manager with ML experience,Lead AI products,3,ingested",
    ].join("\n"),
    "utf8",
  );

  writeFileSync(
    join(memoryDir, "candidate_features.csv"),
    [
      "record_id,candidate_id,resume_id,job_id,feature_type,feature_name,canonical_name,feature_value,confidence,source_text_span",
      "FEAT-1,CAN-000001,RES-000001,JOB-ENG,skill,Python,Python,present,1.0,Python evidence",
      "FEAT-2,CAN-000001,RES-000001,JOB-ENG,skill,Airflow,Apache Airflow,present,0.9,Airflow evidence",
    ].join("\n"),
    "utf8",
  );

  writeFileSync(
    join(memoryDir, "candidate_similarity_edges.csv"),
    [
      "edge_id,source_candidate_id,target_candidate_id,source_resume_id,target_resume_id,job_id,similarity_score,similarity_type,edge_reason",
      "EDGE-1,CAN-000001,CAN-000002,RES-000001,RES-000002,JOB-ENG,0.91,bge,shared_features=Python",
    ].join("\n"),
    "utf8",
  );

  writeFileSync(
    join(memoryDir, "graph_projection_memory.csv"),
    [
      "projection_id,candidate_id,resume_id,job_id,review_mode,neighbor_count,selected_neighbor_count,rejected_neighbor_count,avg_neighbor_similarity,weighted_neighbor_select_rate,job_select_prior,graph_score,projection_label,projection_confidence,projection_evidence,graph_signal_summary",
      "PROJ-1,CAN-000001,RES-000001,JOB-ENG,graph_projection_review,1,1,0,0.91,1,0.5,0.83,likely_select,0.91,evidence,Strong graph signal",
    ].join("\n"),
    "utf8",
  );

  writeFileSync(
    join(memoryDir, "jobs.csv"),
    [
      "job_id,raw_role_name,normalized_role_name,job_description,candidate_count,select_count,reject_count,hiring_profile_summary,common_select_patterns,common_reject_patterns",
      "JOB-ENG,Data Engineer,data engineer,Build data pipelines,2,1,1,Data role memory,Python,No data engineering",
      "JOB-PM,Product Manager,product manager,Lead AI products,1,1,0,PM role memory,ML,No product sense",
    ].join("\n"),
    "utf8",
  );

  return root;
}

describe("competition-demo-view-model", () => {
  it("overview returns safe read-only flags", () => {
    const root = makeFixture();
    const overview = buildCompetitionDemoOverview({ competitionRoot: root });

    assert.equal(overview.safety.readOnly, true);
    assert.equal(overview.safety.evidenceMayEnterPrompt, false);
    assert.equal(overview.safety.writesAllowed, false);
    assert.equal(overview.safety.humanDecisionRequired, true);
    assert.equal(overview.status, "ready");
    assert.equal(overview.candidateCount, 3);

    rmSync(root, { recursive: true, force: true });
  });

  it("overview returns error status when data is missing", () => {
    const overview = buildCompetitionDemoOverview({ competitionRoot: "/nonexistent/path" });
    assert.equal(overview.status, "error");
    assert.equal(overview.candidateCount, 0);
    assert.equal(overview.safety.readOnly, true);
  });

  it("search returns cards and never raw evidence JSON", () => {
    const root = makeFixture();
    const result = buildCompetitionSearchResult("", { competitionRoot: root });

    assert.equal(result.mode, "demo_search");
    assert.ok(result.candidates.length > 0);

    const card = result.candidates[0]!;
    assert.ok(card.candidateId);
    assert.ok(card.role);
    assert.ok(card.headline);
    assert.ok(typeof card.matchScore === "number");
    assert.ok(card.recommendationLabel);
    assert.ok(Array.isArray(card.topReasons));
    assert.ok(Array.isArray(card.riskNotes));
    assert.ok(Array.isArray(card.featureBadges));

    // Verify no raw evidence JSON in output
    const jsonStr = JSON.stringify(result);
    assert.ok(!jsonStr.includes("evidencePool"));
    assert.ok(!jsonStr.includes("sourceRef"));

    rmSync(root, { recursive: true, force: true });
  });

  it("search handles empty query with default top list", () => {
    const root = makeFixture();
    const result = buildCompetitionSearchResult("", { competitionRoot: root });

    assert.ok(result.candidates.length > 0);
    assert.ok(result.safeSummary.includes("推荐候选人"));

    rmSync(root, { recursive: true, force: true });
  });

  it("search filters by keyword", () => {
    const root = makeFixture();
    const result = buildCompetitionSearchResult("Python", { competitionRoot: root });

    assert.ok(result.candidates.length > 0);
    assert.ok(result.safeSummary.includes("Python"));

    rmSync(root, { recursive: true, force: true });
  });

  it("review returns graph projection for a known candidate", () => {
    const root = makeFixture();
    const review = buildCompetitionCandidateReview("CAN-000001", { competitionRoot: root });

    assert.ok(review !== null);
    assert.equal(review!.candidate.candidateId, "CAN-000001");
    assert.ok(review!.graphProjection !== null);
    assert.equal(review!.graphProjection!.confidence, 0.91);
    assert.equal(review!.graphProjection!.graphScore, 0.83);
    assert.equal(review!.graphProjection!.neighborCount, 1);
    assert.ok(review!.graphProjection!.signalSummary.includes("Strong graph signal"));
    assert.ok(review!.roleMemory !== null);
    assert.ok(review!.roleMemory!.includes("Data role memory"));
    assert.deepEqual(
      review!.matchedFeatures.map((feature) => feature.canonicalName),
      ["Python", "Apache Airflow"],
    );
    assert.equal(review!.similarCandidates[0]!.candidateId, "CAN-000002");
    assert.equal(review!.similarCandidates[0]!.similarityScore, 0.91);
    assert.ok(review!.humanDecisionCheckpoint.includes("人类做最终决策"));

    rmSync(root, { recursive: true, force: true });
  });

  it("review returns null for missing candidate", () => {
    const root = makeFixture();
    const review = buildCompetitionCandidateReview("CAN-NONEXIST", { competitionRoot: root });

    assert.equal(review, null);

    rmSync(root, { recursive: true, force: true });
  });

  it("API responses do not expose forbidden strings", () => {
    const root = makeFixture();
    const overview = buildCompetitionDemoOverview({ competitionRoot: root });
    const search = buildCompetitionSearchResult("", { competitionRoot: root });
    const review = buildCompetitionCandidateReview("CAN-000001", { competitionRoot: root });

    const forbidden = ["payload", "stdout", "stderr", "apiKey", "endpoint", "modelId"];
    for (const word of forbidden) {
      assert.ok(!JSON.stringify(overview).includes(word), `overview contains "${word}"`);
      assert.ok(!JSON.stringify(search).includes(word), `search contains "${word}"`);
      if (review) {
        assert.ok(!JSON.stringify(review).includes(word), `review contains "${word}"`);
      }
    }

    // Verify no raw local paths
    assert.ok(!JSON.stringify(overview).includes(root), "overview exposes local path");
    assert.ok(!JSON.stringify(search).includes(root), "search exposes local path");
    if (review) {
      assert.ok(!JSON.stringify(review).includes(root), "review exposes local path");
    }

    rmSync(root, { recursive: true, force: true });
  });

  it("sanitizeCompetitionText redacts sensitive patterns", () => {
    assert.equal(sanitizeCompetitionText("normal text"), "normal text");
    assert.equal(sanitizeCompetitionText("payload data"), "[已脱敏]");
    assert.equal(sanitizeCompetitionText("apiKey=secret"), "[已脱敏]");
  });
});
