import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createServer } from "../../src/server/server.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

interface CompetitionOverview {
  status: string;
  candidateCount: number;
  evidenceCount: number;
  safety: {
    readOnly: boolean;
    evidenceMayEnterPrompt: boolean;
    writesAllowed: boolean;
    humanDecisionRequired: boolean;
  };
}

interface CompetitionSearchResult {
  mode: string;
  candidates: Array<{
    candidateId: string;
    matchScore: number;
  }>;
  safeSummary: string;
}

interface CompetitionCandidateReview {
  candidate: {
    candidateId: string;
  };
  graphProjection: {
    confidence: number;
  } | null;
  humanDecisionCheckpoint: string;
}

function makeFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "hireloop-api-test-"));
  const memoryDir = join(root, "artifacts", "memory_graph");
  mkdirSync(memoryDir, { recursive: true });

  writeFileSync(
    join(memoryDir, "resumes.csv"),
    [
      "resume_id,candidate_id,job_id,raw_role,normalized_role,resume_text,job_description,source_dataset_row,ingest_status",
      "RES-ROUTE-001,CAN-ROUTE-001,JOB-ROUTE-ENG,Data Engineer,data engineer,Experienced Python developer,Build pipelines,1,ingested",
      "RES-ROUTE-002,CAN-ROUTE-002,JOB-ROUTE-PM,Product Manager,product manager,AI product manager,Lead products,2,ingested",
    ].join("\n"),
    "utf8",
  );

  writeFileSync(
    join(memoryDir, "candidate_features.csv"),
    [
      "record_id,candidate_id,resume_id,job_id,feature_type,feature_name,canonical_name,feature_value,confidence,source_text_span",
      "FEAT-1,CAN-ROUTE-001,RES-ROUTE-001,JOB-ROUTE-ENG,skill,Python,Python,present,1.0,Python evidence",
    ].join("\n"),
    "utf8",
  );

  writeFileSync(
    join(memoryDir, "candidate_similarity_edges.csv"),
    [
      "edge_id,source_candidate_id,target_candidate_id,source_resume_id,target_resume_id,job_id,similarity_score,similarity_type,edge_reason",
      "EDGE-1,CAN-ROUTE-001,CAN-ROUTE-002,RES-ROUTE-001,RES-ROUTE-002,JOB-ROUTE-ENG,0.85,bge,shared_features",
    ].join("\n"),
    "utf8",
  );

  writeFileSync(
    join(memoryDir, "graph_projection_memory.csv"),
    [
      "projection_id,candidate_id,resume_id,job_id,review_mode,neighbor_count,selected_neighbor_count,rejected_neighbor_count,avg_neighbor_similarity,weighted_neighbor_select_rate,job_select_prior,graph_score,projection_label,projection_confidence,projection_evidence,graph_signal_summary",
      "PROJ-1,CAN-ROUTE-001,RES-ROUTE-001,JOB-ROUTE-ENG,graph_projection_review,1,1,0,0.85,1,0.5,0.80,likely_select,0.85,evidence,Strong graph signal",
    ].join("\n"),
    "utf8",
  );

  writeFileSync(
    join(memoryDir, "jobs.csv"),
    [
      "job_id,raw_role_name,normalized_role_name,job_description,candidate_count,select_count,reject_count,hiring_profile_summary,common_select_patterns,common_reject_patterns",
      "JOB-ROUTE-ENG,Data Engineer,data engineer,Build pipelines,1,1,0,Data role memory,Python,No data engineering",
      "JOB-ROUTE-PM,Product Manager,product manager,Lead products,1,1,0,PM role memory,ML,No product sense",
    ].join("\n"),
    "utf8",
  );

  return root;
}

describe("competition API routes", () => {
  let server: http.Server;
  let root: string;

  before(() => {
    root = makeFixture();
    process.env["HIRELOOP_COMPETITION_ROOT"] = root;
    server = createServer();
    server.listen(3999, "127.0.0.1");
  });

  after(() => {
    server.close();
    rmSync(root, { recursive: true, force: true });
    delete process.env["HIRELOOP_COMPETITION_ROOT"];
  });

  it("/api/competition/overview returns safe read-only flags", async () => {
    const res = await fetch("http://localhost:3999/api/competition/overview");
    assert.equal(res.status, 200);
    const data = (await res.json()) as CompetitionOverview;
    assert.equal(data.safety.readOnly, true);
    assert.equal(data.safety.evidenceMayEnterPrompt, false);
    assert.equal(data.safety.writesAllowed, false);
    assert.equal(data.safety.humanDecisionRequired, true);
  });

  it("/api/competition/search returns cards without raw JSON", async () => {
    const res = await fetch("http://localhost:3999/api/competition/search");
    assert.equal(res.status, 200);
    const data = (await res.json()) as CompetitionSearchResult;
    assert.ok(Array.isArray(data.candidates));
    assert.ok(data.candidates.length > 0);

    const jsonStr = JSON.stringify(data);
    assert.ok(!jsonStr.includes("evidencePool"));
    assert.ok(!jsonStr.includes("sourceRef"));
    assert.ok(!jsonStr.includes("resume_text"));
  });

  it("/api/competition/search?q=Python filters results", async () => {
    const res = await fetch("http://localhost:3999/api/competition/search?q=Python");
    assert.equal(res.status, 200);
    const data = (await res.json()) as CompetitionSearchResult;
    assert.ok(data.safeSummary.includes("Python"));
  });

  it("/api/competition/review returns review for valid candidate", async () => {
    const res = await fetch("http://localhost:3999/api/competition/review?candidateId=CAN-ROUTE-001");
    assert.equal(res.status, 200);
    const data = (await res.json()) as CompetitionCandidateReview;
    assert.equal(data.candidate.candidateId, "CAN-ROUTE-001");
    assert.ok(data.graphProjection !== null);
    assert.ok(data.humanDecisionCheckpoint.includes("人类做最终决策"));
  });

  it("/api/competition/review returns 404 for missing candidate", async () => {
    const res = await fetch("http://localhost:3999/api/competition/review?candidateId=CAN-NONEXIST");
    assert.equal(res.status, 404);
  });

  it("/api/competition/review returns 400 for empty candidateId", async () => {
    const res = await fetch("http://localhost:3999/api/competition/review?candidateId=");
    assert.equal(res.status, 400);
  });

  it("API responses do not expose forbidden strings", async () => {
    const forbidden = ["payload", "stdout", "stderr", "apiKey", "endpoint", "modelId"];

    const overviewRes = await fetch("http://localhost:3999/api/competition/overview");
    const overview = await overviewRes.text();
    for (const word of forbidden) {
      assert.ok(!overview.includes(word), `overview contains "${word}"`);
    }

    const searchRes = await fetch("http://localhost:3999/api/competition/search");
    const search = await searchRes.text();
    for (const word of forbidden) {
      assert.ok(!search.includes(word), `search contains "${word}"`);
    }

    const reviewRes = await fetch("http://localhost:3999/api/competition/review?candidateId=CAN-ROUTE-001");
    const review = await reviewRes.text();
    for (const word of forbidden) {
      assert.ok(!review.includes(word), `review contains "${word}"`);
    }
  });

  it("API responses do not expose raw local paths", async () => {
    const overviewRes = await fetch("http://localhost:3999/api/competition/overview");
    const overview = await overviewRes.text();
    assert.ok(!overview.includes(root), "overview exposes local path");

    const searchRes = await fetch("http://localhost:3999/api/competition/search");
    const search = await searchRes.text();
    assert.ok(!search.includes(root), "search exposes local path");

    const reviewRes = await fetch("http://localhost:3999/api/competition/review?candidateId=CAN-ROUTE-001");
    const review = await reviewRes.text();
    assert.ok(!review.includes(root), "review exposes local path");
  });
});
