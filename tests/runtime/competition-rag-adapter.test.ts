import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildCompetitionRagEnvelope,
  parseCsv,
} from "../../src/runtime/competition-rag-adapter.js";
import { loadAgentInputBundles } from "../../src/runtime/bundle-loader.js";
import { verifyBundles } from "../../src/runtime/rag-dataset-verification.js";

describe("competition-rag-adapter", () => {
  it("parses quoted CSV fields with embedded commas and newlines", () => {
    const rows = parseCsv("a,b\n1,\"two, with comma\"\n2,\"line\nbreak\"\n");
    assert.deepEqual(rows, [
      ["a", "b"],
      ["1", "two, with comma"],
      ["2", "line\nbreak"],
    ]);
  });

  it("builds a HireLoop-compatible RAG envelope from competition artifacts", () => {
    const root = makeCompetitionFixture();
    const result = buildCompetitionRagEnvelope({
      competitionRoot: root,
      limit: 1,
      maxFeaturesPerCandidate: 2,
      maxNeighborsPerCandidate: 1,
    });

    assert.equal(result.report.status, "ready");
    assert.equal(result.report.candidateCount, 1);
    assert.equal(result.envelope.candidates.length, 1);
    assert.equal(result.envelope.candidates[0]!.candidate.candidateId, "CAN-000001");
    assert.ok(result.envelope.evidencePool.length >= 4);

    const loaded = loadAgentInputBundles({ inputJson: JSON.stringify([result.envelope]) });
    const verification = verifyBundles(loaded, false);
    assert.equal(verification.status, "passed");
    assert.equal(verification.evidenceCoverage.withEvidence, 1);
    assert.equal(verification.guardrailSummary.evidenceMayEnterPrompt, false);
  });
});

function makeCompetitionFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "hireloop-competition-"));
  const memoryDir = join(root, "artifacts", "memory_graph");
  mkdirSync(memoryDir, { recursive: true });

  writeFileSync(
    join(memoryDir, "resumes.csv"),
    [
      "resume_id,candidate_id,job_id,raw_role,normalized_role,resume_text,job_description,source_dataset_row,ingest_status",
      "RES-000001,CAN-000001,JOB-DATA,Data Engineer,data engineer,\"Resume, with comma\",Build pipelines,1,ingested",
      "RES-000002,CAN-000002,JOB-DATA,Data Engineer,data engineer,Neighbor resume,Build pipelines,2,ingested",
    ].join("\n"),
    "utf8",
  );

  writeFileSync(
    join(memoryDir, "candidate_features.csv"),
    [
      "record_id,candidate_id,resume_id,job_id,feature_type,feature_name,canonical_name,feature_value,confidence,source_text_span",
      "FEAT-1,CAN-000001,RES-000001,JOB-DATA,skill,Python,Python,present,1.0,Python evidence",
      "FEAT-2,CAN-000001,RES-000001,JOB-DATA,skill,Airflow,Apache Airflow,present,0.9,Airflow evidence",
    ].join("\n"),
    "utf8",
  );

  writeFileSync(
    join(memoryDir, "candidate_similarity_edges.csv"),
    [
      "edge_id,source_candidate_id,target_candidate_id,source_resume_id,target_resume_id,job_id,similarity_score,similarity_type,edge_reason",
      "EDGE-1,CAN-000001,CAN-000002,RES-000001,RES-000002,JOB-DATA,0.91,bge,shared_features=Python",
    ].join("\n"),
    "utf8",
  );

  writeFileSync(
    join(memoryDir, "graph_projection_memory.csv"),
    [
      "projection_id,candidate_id,resume_id,job_id,review_mode,neighbor_count,selected_neighbor_count,rejected_neighbor_count,avg_neighbor_similarity,weighted_neighbor_select_rate,job_select_prior,graph_score,projection_label,projection_confidence,projection_evidence,graph_signal_summary",
      "PROJ-1,CAN-000001,RES-000001,JOB-DATA,graph_projection_review,1,1,0,0.91,1,0.5,0.83,likely_select,0.91,evidence,Strong graph signal",
    ].join("\n"),
    "utf8",
  );

  writeFileSync(
    join(memoryDir, "jobs.csv"),
    [
      "job_id,raw_role_name,normalized_role_name,job_description,candidate_count,select_count,reject_count,hiring_profile_summary,common_select_patterns,common_reject_patterns",
      "JOB-DATA,Data Engineer,data engineer,Build pipelines,2,1,1,Data role memory,Python,No data engineering",
    ].join("\n"),
    "utf8",
  );

  return root;
}
