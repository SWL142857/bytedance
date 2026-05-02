import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RetrievedEvidence } from "./bundle-loader.js";

export interface CompetitionRagAdapterOptions {
  competitionRoot: string;
  limit?: number;
  maxFeaturesPerCandidate?: number;
  maxNeighborsPerCandidate?: number;
}

export interface CompetitionRagEnvelopeCandidate {
  candidate: {
    candidateRecordId: string;
    candidateId: string;
    resumeText: string;
    sourceMetadata?: Record<string, string>;
  };
  job: {
    jobRecordId: string;
    jobId: string;
    requirements: string;
    rubric: string;
    department?: string;
    level?: string;
  };
  evidenceIds: string[];
}

export interface CompetitionRagEnvelope {
  candidates: CompetitionRagEnvelopeCandidate[];
  evidencePool: Omit<RetrievedEvidence, "redactionStatus">[];
}

export interface CompetitionRagBuildReport {
  status: "ready" | "partial";
  competitionRoot: string;
  candidateCount: number;
  evidenceCount: number;
  missingOptionalFiles: string[];
  safeSummary: string;
}

export interface CompetitionRagBuildResult {
  envelope: CompetitionRagEnvelope;
  report: CompetitionRagBuildReport;
}

interface ResumeRow {
  resume_id: string;
  candidate_id: string;
  job_id: string;
  raw_role: string;
  normalized_role: string;
  resume_text: string;
  job_description: string;
  source_dataset_row: string;
  ingest_status: string;
}

interface FeatureRow {
  candidate_id: string;
  feature_type: string;
  canonical_name: string;
  feature_value: string;
  confidence: string;
  source_text_span: string;
}

interface EdgeRow {
  source_candidate_id: string;
  target_candidate_id: string;
  similarity_score: string;
  edge_reason: string;
}

interface ProjectionRow {
  candidate_id: string;
  review_mode: string;
  neighbor_count: string;
  graph_score: string;
  projection_label: string;
  projection_confidence: string;
  graph_signal_summary: string;
}

interface JobRow {
  job_id: string;
  hiring_profile_summary: string;
  common_select_patterns: string;
  common_reject_patterns: string;
}

const DEFAULT_MAX_FEATURES = 8;
const DEFAULT_MAX_NEIGHBORS = 5;
const DATASET_NAME = "competition";

export function buildCompetitionRagEnvelope(
  options: CompetitionRagAdapterOptions,
): CompetitionRagBuildResult {
  const memoryDir = join(options.competitionRoot, "artifacts", "memory_graph");
  const checkpointDir = join(memoryDir, "_checkpoints");
  const missingOptionalFiles: string[] = [];

  const resumes = readRequiredCsv<ResumeRow>(join(memoryDir, "resumes.csv"));
  const featuresByCandidate = groupBy(
    readOptionalCsv<FeatureRow>(join(memoryDir, "candidate_features.csv"), missingOptionalFiles),
    "candidate_id",
  );
  const edgesByCandidate = groupEdges(
    readOptionalCsv<EdgeRow>(join(memoryDir, "candidate_similarity_edges.csv"), missingOptionalFiles),
  );
  const projectionsByCandidate = indexBy(
    readFirstAvailableCsv<ProjectionRow>(
      [
        join(memoryDir, "graph_projection_memory.csv"),
        join(checkpointDir, "graph_projection_memory.csv"),
      ],
      missingOptionalFiles,
      "graph_projection_memory.csv",
    ),
    "candidate_id",
  );
  const jobsById = indexBy(
    readFirstAvailableCsv<JobRow>(
      [
        join(memoryDir, "jobs.csv"),
        join(checkpointDir, "jobs.csv"),
      ],
      missingOptionalFiles,
      "jobs.csv",
    ),
    "job_id",
  );

  const candidates = options.limit && options.limit > 0 ? resumes.slice(0, options.limit) : resumes;
  const evidencePool: Omit<RetrievedEvidence, "redactionStatus">[] = [];
  const envelopeCandidates: CompetitionRagEnvelopeCandidate[] = [];
  let sourceRefIndex = 0;

  for (const row of candidates) {
    const evidenceIds: string[] = [];
    const addEvidence = (evidence: Omit<RetrievedEvidence, "redactionStatus" | "sourceRef">): void => {
      const sourceRef = `dataset:${DATASET_NAME}:${sourceRefIndex++}`;
      evidencePool.push({ sourceRef, ...evidence });
      evidenceIds.push(sourceRef);
    };

    const projection = projectionsByCandidate.get(row.candidate_id);
    if (projection) {
      addEvidence({
        kind: "other",
        usedFor: "hr_review",
        score: parseFiniteNumber(projection.projection_confidence),
        snippet: buildProjectionSnippet(projection),
      });
    }

    const job = jobsById.get(row.job_id);
    if (job) {
      addEvidence({
        kind: "job",
        usedFor: "display",
        snippet: compactText(
          `岗位记忆：${job.hiring_profile_summary} 录用倾向：${job.common_select_patterns}。拒绝倾向：${job.common_reject_patterns}。`,
        ),
      });
    }

    const features = (featuresByCandidate.get(row.candidate_id) ?? [])
      .sort((a, b) => parseFiniteNumber(b.confidence) - parseFiniteNumber(a.confidence))
      .slice(0, options.maxFeaturesPerCandidate ?? DEFAULT_MAX_FEATURES);
    if (features.length > 0) {
      addEvidence({
        kind: "resume",
        usedFor: "display",
        score: average(features.map((feature) => parseFiniteNumber(feature.confidence))),
        snippet: compactText(
          `候选人特征：${features.map(formatFeature).join("；")}。`,
        ),
      });
    }

    const edges = (edgesByCandidate.get(row.candidate_id) ?? [])
      .sort((a, b) => parseFiniteNumber(b.similarity_score) - parseFiniteNumber(a.similarity_score))
      .slice(0, options.maxNeighborsPerCandidate ?? DEFAULT_MAX_NEIGHBORS);
    if (edges.length > 0) {
      addEvidence({
        kind: "other",
        usedFor: "display",
        score: average(edges.map((edge) => parseFiniteNumber(edge.similarity_score))),
        snippet: compactText(
          `相似候选人：${edges.map((edge) => formatNeighbor(row.candidate_id, edge)).join("；")}。`,
        ),
      });
    }

    envelopeCandidates.push({
      candidate: {
        candidateRecordId: `dataset-${row.candidate_id}`,
        candidateId: row.candidate_id,
        resumeText: row.resume_text,
        sourceMetadata: {
          source: DATASET_NAME,
          resumeId: row.resume_id,
          role: safeMetadataValue(row.normalized_role || row.raw_role),
          datasetRow: safeMetadataValue(row.source_dataset_row),
        },
      },
      job: {
        jobRecordId: `dataset-${row.job_id}`,
        jobId: row.job_id,
        requirements: row.job_description,
        rubric: buildRubric(row, job),
      },
      evidenceIds,
    });
  }

  const status = missingOptionalFiles.length === 0 ? "ready" : "partial";
  return {
    envelope: {
      candidates: envelopeCandidates,
      evidencePool,
    },
    report: {
      status,
      competitionRoot: options.competitionRoot,
      candidateCount: envelopeCandidates.length,
      evidenceCount: evidencePool.length,
      missingOptionalFiles,
      safeSummary:
        `Competition RAG adapter prepared ${envelopeCandidates.length} candidates and ${evidencePool.length} evidence items` +
        (missingOptionalFiles.length > 0 ? ` with ${missingOptionalFiles.length} optional source files missing.` : "."),
    },
  };
}

function readRequiredCsv<T extends object>(path: string): T[] {
  if (!existsSync(path)) {
    throw new Error(`Required competition CSV is missing: ${path}`);
  }
  return readCsvFile<T>(path);
}

function readOptionalCsv<T extends object>(path: string, missing: string[]): T[] {
  if (!existsSync(path)) {
    missing.push(path);
    return [];
  }
  return readCsvFile<T>(path);
}

function readFirstAvailableCsv<T extends object>(
  paths: string[],
  missing: string[],
  label: string,
): T[] {
  for (const path of paths) {
    if (existsSync(path)) {
      return readCsvFile<T>(path);
    }
  }
  missing.push(label);
  return [];
}

function readCsvFile<T extends object>(path: string): T[] {
  const rows = parseCsv(readFileSync(path, "utf8"));
  if (rows.length === 0) return [];
  const header = rows[0] ?? [];
  return rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) {
      const key = header[i];
      if (!key) continue;
      record[key] = row[i] ?? "";
    }
    return record as T;
  });
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    const next = text.charAt(i + 1);

    if (inQuotes) {
      if (ch === "\"" && next === "\"") {
        field += "\"";
        i++;
      } else if (ch === "\"") {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === "\"") {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(stripTrailingCr(field));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(stripTrailingCr(field));
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((cell) => cell.length > 0));
}

function stripTrailingCr(value: string): string {
  return value.endsWith("\r") ? value.slice(0, -1) : value;
}

function groupBy<T extends object, K extends keyof T>(rows: T[], key: K): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const value = String(row[key] ?? "");
    const existing = grouped.get(value) ?? [];
    existing.push(row);
    grouped.set(value, existing);
  }
  return grouped;
}

function indexBy<T extends object, K extends keyof T>(rows: T[], key: K): Map<string, T> {
  const indexed = new Map<string, T>();
  for (const row of rows) {
    indexed.set(String(row[key] ?? ""), row);
  }
  return indexed;
}

function groupEdges(rows: EdgeRow[]): Map<string, EdgeRow[]> {
  const grouped = new Map<string, EdgeRow[]>();
  for (const row of rows) {
    addGroupedEdge(grouped, row.source_candidate_id, row);
    addGroupedEdge(grouped, row.target_candidate_id, row);
  }
  return grouped;
}

function addGroupedEdge(grouped: Map<string, EdgeRow[]>, candidateId: string, edge: EdgeRow): void {
  const existing = grouped.get(candidateId) ?? [];
  existing.push(edge);
  grouped.set(candidateId, existing);
}

function buildProjectionSnippet(row: ProjectionRow): string {
  return compactText(
    `图投影：${row.projection_label}，置信度 ${row.projection_confidence}，图分 ${row.graph_score}，` +
    `邻居数 ${row.neighbor_count}，模式 ${row.review_mode}。${row.graph_signal_summary}`,
  );
}

function buildRubric(row: ResumeRow, job?: JobRow): string {
  const role = row.normalized_role || row.raw_role || "candidate";
  if (!job) {
    return `Evaluate ${role} fit using role requirements, resume facts, graph evidence, risks, and human-review readiness.`;
  }
  return compactText(
    `Evaluate ${role} fit. Role memory: ${job.hiring_profile_summary} Select patterns: ${job.common_select_patterns}. Reject patterns: ${job.common_reject_patterns}.`,
  );
}

function formatFeature(row: FeatureRow): string {
  const value = row.feature_value && row.feature_value !== "present" ? `=${row.feature_value}` : "";
  return `${row.feature_type}:${row.canonical_name}${value}`;
}

function formatNeighbor(candidateId: string, row: EdgeRow): string {
  const other = row.source_candidate_id === candidateId ? row.target_candidate_id : row.source_candidate_id;
  return `${other} 相似度 ${row.similarity_score}（${row.edge_reason}）`;
}

function parseFiniteNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function safeMetadataValue(value: string): string {
  return compactText(value).replace(/[^A-Za-z0-9 _.-]/g, "_").slice(0, 200) || "unknown";
}
