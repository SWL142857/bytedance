import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { containsSensitivePattern } from "../server/redaction.js";
import type { CandidatePipelineInput } from "../orchestrator/candidate-pipeline.js";

// ── Types ──

export interface CandidateProfile {
  candidateRecordId: string;
  candidateId: string;
  resumeText: string;
  sourceMetadata?: Record<string, string>;
}

export interface JobContext {
  jobRecordId: string;
  jobId: string;
  requirements: string;
  rubric: string;
  department?: string;
  level?: string;
}

export interface RetrievedEvidence {
  sourceRef: string;
  kind: "resume" | "job" | "company" | "interview" | "note" | "other";
  usedFor: "screening" | "interview_kit" | "hr_review" | "verification" | "display";
  snippet?: string;
  score?: number;
  redactionStatus: "clean" | "truncated" | "blocked";
}

export interface BundleProvenance {
  inputSource: "json" | "jsonl" | "file" | "mock";
  evidenceSource: "mock" | "jsonl" | "retriever" | "none";
  evidenceHash?: string;
  generatedAt: string;
}

export interface GuardFlags {
  allowProvider: false;
  allowWrites: false;
  evidenceMayEnterPrompt: false;
}

export interface AgentInputBundle {
  candidate: CandidateProfile;
  job: JobContext;
  evidence: RetrievedEvidence[];
  provenance: BundleProvenance;
  runMode: "deterministic" | "provider" | "evaluation";
  guardFlags: GuardFlags;
}

export interface BundleLoadResult {
  bundles: AgentInputBundle[];
  totalCount: number;
  errorCount: number;
  errors: string[];
}

// ── Source reference validation ──

const DATASET_SOURCE_REF_RE = /^dataset:[A-Za-z0-9_-]+:\d+$/;
const NOTE_SOURCE_REF_RE = /^note:[A-Za-z0-9_-]+$/;
const BASE_SOURCE_REF_RE = /^base:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/;

export function isValidSourceRef(ref: string): boolean {
  if (typeof ref !== "string" || ref.trim().length === 0) return false;
  const value = ref.trim();
  if (value !== ref) return false;
  if (containsSensitivePattern(value)) return false;
  return (
    DATASET_SOURCE_REF_RE.test(value) ||
    NOTE_SOURCE_REF_RE.test(value) ||
    BASE_SOURCE_REF_RE.test(value)
  );
}

// ── Evidence cleaning ──

const MAX_SNIPPET_LENGTH = 500;

export function cleanEvidenceSnippet(
  snippet: string | null | undefined,
): { text: string; status: "clean" | "truncated" | "blocked" } {
  if (snippet == null || snippet.length === 0) {
    return { text: "", status: "clean" };
  }

  if (containsSensitivePattern(snippet)) {
    return { text: "", status: "blocked" };
  }

  if (snippet.length > MAX_SNIPPET_LENGTH) {
    return { text: snippet.slice(0, MAX_SNIPPET_LENGTH) + "[已截断]", status: "truncated" };
  }

  return { text: snippet, status: "clean" };
}

// ── Evidence hash ──

export function computeEvidenceHash(evidence: RetrievedEvidence[]): string {
  const parts: string[] = [];
  for (const e of evidence) {
    parts.push(e.sourceRef);
    parts.push(e.kind);
    parts.push(e.usedFor);
    parts.push(e.snippet ?? "");
    parts.push(String(e.score ?? ""));
    parts.push(e.redactionStatus);
  }
  const canonical = parts.join("\x00");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

// ── Evidence pool join ──

export function joinEvidence(
  _candidate: CandidateProfile,
  pool: RetrievedEvidence[],
  mapping: Map<string, string[]>,
): RetrievedEvidence[] {
  const ids = mapping.get(_candidate.candidateId);
  if (!ids || ids.length === 0) return [];
  const lookup = new Map<string, RetrievedEvidence>();
  for (const e of pool) {
    lookup.set(e.sourceRef, e);
  }
  const result: RetrievedEvidence[] = [];
  for (const id of ids) {
    const matched = lookup.get(id);
    if (matched) result.push(matched);
  }
  return result;
}

// ── Adapter ──

export function agentInputBundleToPipelineInput(
  bundle: AgentInputBundle,
): CandidatePipelineInput {
  return {
    candidateRecordId: bundle.candidate.candidateRecordId,
    jobRecordId: bundle.job.jobRecordId,
    candidateId: bundle.candidate.candidateId,
    jobId: bundle.job.jobId,
    resumeText: bundle.candidate.resumeText,
    jobRequirements: bundle.job.requirements,
    jobRubric: bundle.job.rubric,
  };
}

// ── Loader ──

const LOCKED_GUARD_FLAGS: GuardFlags = {
  allowProvider: false,
  allowWrites: false,
  evidenceMayEnterPrompt: false,
};

export interface DatasetInputSource {
  inputFile?: string | null;
  inputJson?: string | null;
}

interface RawBundleSource {
  items: unknown[];
  inputSource: BundleProvenance["inputSource"];
}

function parseDatasetText(text: string, label: string): { items: unknown[]; format: "json" | "jsonl" } {
  text = text.trim();

  // Try JSON array first
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return { items: parsed as unknown[], format: "json" };
    throw new Error("not array");
  } catch {
    // Fall through to JSONL
  }

  // JSONL
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) {
    throw new Error(`${label} contains no data.`);
  }

  const items: unknown[] = [];
  for (const line of lines) {
    try {
      items.push(JSON.parse(line));
    } catch {
      throw new Error(`${label} contains an invalid JSONL line.`);
    }
  }

  return { items, format: "jsonl" };
}

function loadRawBundleSource(source: DatasetInputSource): RawBundleSource {
  const inputFile = source.inputFile?.trim() || null;
  const inputJson = source.inputJson?.trim() || null;

  if (inputFile && inputJson) {
    throw new Error("Only one input source is allowed.");
  }

  let text: string;
  let label: string;

  if (inputFile) {
    try {
      text = readFileSync(inputFile, "utf8");
    } catch {
      throw new Error("Failed to read input file.");
    }
    label = "input file";
  } else if (inputJson) {
    text = inputJson;
    label = "input JSON";
  } else {
    throw new Error("Bundle input is required. Provide --input-file or --input-json.");
  }

  const parsed = parseDatasetText(text, label);
  const items = parsed.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(`${label} must be a non-empty JSON array or JSONL.`);
  }

  return {
    items,
    inputSource: inputFile ? "file" : parsed.format,
  };
}

function parseCandidateProfile(raw: Record<string, unknown>, idx: number): CandidateProfile {
  const candidateRecordId = requireString(raw, "candidateRecordId", idx);
  const candidateId = requireString(raw, "candidateId", idx);
  const resumeText = requireString(raw, "resumeText", idx);
  const sourceMetadata = parseSourceMetadata(raw.sourceMetadata);
  return { candidateRecordId, candidateId, resumeText, sourceMetadata };
}

function parseJobContext(raw: Record<string, unknown>, idx: number): JobContext {
  return {
    jobRecordId: requireString(raw, "jobRecordId", idx),
    jobId: requireString(raw, "jobId", idx),
    requirements: requireString(raw, "requirements", idx),
    rubric: requireString(raw, "rubric", idx),
    department: optionalString(raw, "department"),
    level: optionalString(raw, "level"),
  };
}

function parseEvidence(raw: Record<string, unknown>, idx: number): RetrievedEvidence | null {
  const sourceRef = requireString(raw, "sourceRef", idx);
  if (!isValidSourceRef(sourceRef)) return null;

  const kind = parseEnum(raw, "kind", ["resume", "job", "company", "interview", "note", "other"], "other");
  const usedFor = parseEnum(raw, "usedFor", ["screening", "interview_kit", "hr_review", "verification", "display"], "display");
  const snippet = typeof raw.snippet === "string" ? raw.snippet : undefined;
  const score = typeof raw.score === "number" && Number.isFinite(raw.score) ? raw.score : undefined;

  const cleaned = cleanEvidenceSnippet(snippet);

  return {
    sourceRef,
    kind: kind as RetrievedEvidence["kind"],
    usedFor: usedFor as RetrievedEvidence["usedFor"],
    snippet: cleaned.status === "blocked" ? undefined : (cleaned.text || undefined),
    score,
    redactionStatus: cleaned.status,
  };
}

function parseEvidenceList(raw: unknown, candidateIdx: number): RetrievedEvidence[] {
  if (!Array.isArray(raw)) return [];
  const result: RetrievedEvidence[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] && typeof raw[i] === "object" && !Array.isArray(raw[i])) {
      const evidence = parseEvidence(raw[i] as Record<string, unknown>, candidateIdx);
      if (evidence) result.push(evidence);
    }
  }
  return result;
}

function parseEvidencePool(raw: unknown): RetrievedEvidence[] {
  if (!Array.isArray(raw)) return [];
  const result: RetrievedEvidence[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] && typeof raw[i] === "object" && !Array.isArray(raw[i])) {
      const evidence = parseEvidence(raw[i] as Record<string, unknown>, -1);
      if (evidence) result.push(evidence);
    }
  }
  return result;
}

function parseEvidenceMapping(raw: unknown): Map<string, string[]> {
  const result = new Map<string, string[]>();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
  const obj = raw as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      result.set(key, value.filter((v): v is string => typeof v === "string"));
    }
  }
  return result;
}

function safeBundleError(index: number, err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (containsSensitivePattern(raw)) {
    return `Bundle ${index}: [已脱敏]`;
  }
  return `Bundle ${index}: ${raw}`;
}

// ── Main loader ──

export function loadAgentInputBundles(source: DatasetInputSource): BundleLoadResult {
  const rawSource = loadRawBundleSource(source);
  const raw = rawSource.items;
  const bundles: AgentInputBundle[] = [];
  const errors: string[] = [];
  const generatedAt = new Date().toISOString();

  // Check for top-level evidence pool
  let globalPool: RetrievedEvidence[] = [];
  let globalMapping: Map<string, string[]> = new Map();

  // Top-level structure: can be { candidates: [...], evidencePool: [...], evidenceMapping: {...} }
  // or a direct array of candidate entries
  let candidates: unknown[];
  const rawFirst = raw[0];
  if (raw.length === 1 && typeof rawFirst === "object" && rawFirst !== null && !Array.isArray(rawFirst)) {
    const envelope = rawFirst as Record<string, unknown>;
    if (Array.isArray(envelope.candidates)) {
      candidates = envelope.candidates as unknown[];
      if (envelope.evidencePool) {
        globalPool = parseEvidencePool(envelope.evidencePool);
      }
      if (envelope.evidenceMapping) {
        globalMapping = parseEvidenceMapping(envelope.evidenceMapping);
      }
    } else {
      candidates = raw;
    }
  } else {
    candidates = raw;
  }

  for (let i = 0; i < candidates.length; i++) {
    try {
      const entry = candidates[i];
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        errors.push(`Bundle ${i}: entry must be a JSON object.`);
        continue;
      }
      const obj = entry as Record<string, unknown>;

      const candidate = parseCandidateProfile(
        (obj.candidate ?? obj) as Record<string, unknown>, i,
      );
      const job = parseJobContext(
        (obj.job ?? obj) as Record<string, unknown>, i,
      );

      // Collect evidence
      let evidence: RetrievedEvidence[];
      if (Array.isArray(obj.evidence)) {
        evidence = parseEvidenceList(obj.evidence, i);
      } else if (Array.isArray(obj.evidenceIds) && globalPool.length > 0) {
        const ids = obj.evidenceIds.filter((v): v is string => typeof v === "string");
        const mapping = globalMapping.size > 0
          ? globalMapping
          : new Map([[candidate.candidateId, ids]]);
        evidence = joinEvidence(candidate, globalPool, mapping);
      } else {
        evidence = [];
      }

      const evidenceHash = computeEvidenceHash(evidence);

      bundles.push({
        candidate,
        job,
        evidence,
        provenance: {
          inputSource: rawSource.inputSource,
          evidenceSource: evidence.length > 0 ? (globalPool.length > 0 ? "jsonl" : "jsonl") : "none",
          evidenceHash,
          generatedAt,
        },
        runMode: "deterministic",
        guardFlags: { ...LOCKED_GUARD_FLAGS },
      });
    } catch (err) {
      errors.push(safeBundleError(i, err));
    }
  }

  return { bundles, totalCount: candidates.length, errorCount: errors.length, errors };
}

// ── Helpers ──

function requireString(record: Record<string, unknown>, key: string, idx: number): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Entry ${idx}: field "${key}" must be a non-empty string.`);
  }
  return value;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value === "string" && value.trim().length > 0) return value;
  return undefined;
}

const SAFE_METADATA_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SAFE_METADATA_VALUE_RE = /^[A-Za-z0-9 _.-]{1,200}$/;

function parseSourceMetadata(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    const safeKey = key.trim();
    const safeValue = value.trim();
    if (!SAFE_METADATA_KEY_RE.test(safeKey)) continue;
    if (!SAFE_METADATA_VALUE_RE.test(safeValue)) continue;
    if (containsSensitivePattern(safeKey) || containsSensitivePattern(safeValue)) continue;
    result[safeKey] = safeValue;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function parseEnum<T extends string>(
  record: Record<string, unknown>,
  key: string,
  allowed: T[],
  fallback: T,
): T {
  const value = record[key];
  if (typeof value === "string" && (allowed as string[]).includes(value)) {
    return value as T;
  }
  return fallback;
}
