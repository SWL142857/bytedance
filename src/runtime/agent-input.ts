import { readFileSync } from "node:fs";
import type { ResumeParserInput } from "../agents/resume-parser.js";
import type { CandidatePipelineInput } from "../orchestrator/candidate-pipeline.js";

export interface JsonInputSource {
  inputFile?: string | null;
  inputJson?: string | null;
}

export function loadJsonInput(source: JsonInputSource): unknown | null {
  const inputFile = source.inputFile?.trim() || null;
  const inputJson = source.inputJson?.trim() || null;

  if (inputFile && inputJson) {
    throw new Error("Only one input source is allowed. Use either --input-file or --input-json.");
  }

  if (inputFile) {
    return parseJson(readFileSync(inputFile, "utf8"), "input file");
  }

  if (inputJson) {
    return parseJson(inputJson, "input JSON");
  }

  return null;
}

export function loadResumeParserInput(source: JsonInputSource): ResumeParserInput {
  return parseResumeParserInputValue(requireJsonInput(source, "Resume Parser"));
}

export function loadCandidatePipelineInput(source: JsonInputSource): CandidatePipelineInput {
  return parseCandidatePipelineInputValue(requireJsonInput(source, "Candidate pipeline"));
}

export function parseResumeParserInputValue(value: unknown): ResumeParserInput {
  const record = asRecord(value, "Resume Parser input");
  const fromStatus = requireString(record, "fromStatus", "Resume Parser input");
  if (fromStatus !== "new") {
    throw new Error('Resume Parser input field "fromStatus" must be "new".');
  }

  return {
    candidateRecordId: requireString(record, "candidateRecordId", "Resume Parser input"),
    candidateId: requireString(record, "candidateId", "Resume Parser input"),
    resumeText: requireString(record, "resumeText", "Resume Parser input"),
    fromStatus,
  };
}

export function parseCandidatePipelineInputValue(value: unknown): CandidatePipelineInput {
  const record = asRecord(value, "Candidate pipeline input");
  return {
    candidateRecordId: requireString(record, "candidateRecordId", "Candidate pipeline input"),
    jobRecordId: requireString(record, "jobRecordId", "Candidate pipeline input"),
    candidateId: requireString(record, "candidateId", "Candidate pipeline input"),
    jobId: requireString(record, "jobId", "Candidate pipeline input"),
    resumeText: requireString(record, "resumeText", "Candidate pipeline input"),
    jobRequirements: requireString(record, "jobRequirements", "Candidate pipeline input"),
    jobRubric: requireString(record, "jobRubric", "Candidate pipeline input"),
  };
}

function requireJsonInput(source: JsonInputSource, label: string): unknown {
  const value = loadJsonInput(source);
  if (value === null) {
    throw new Error(`${label} input is required. Provide --input-file or --input-json.`);
  }
  return value;
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Failed to parse ${label} as JSON.`);
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function requireString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} field "${key}" must be a non-empty string.`);
  }
  return value;
}
