import { readFileSync } from "node:fs";
import { parseCandidatePipelineInputValue } from "./agent-input.js";
import type { CandidatePipelineInput } from "../orchestrator/candidate-pipeline.js";
import { containsSensitivePattern } from "../server/redaction.js";

export interface DatasetLoadResult {
  inputs: CandidatePipelineInput[];
  totalCount: number;
  errorCount: number;
  errors: string[];
}

export interface DatasetInputSource {
  inputFile?: string | null;
  inputJson?: string | null;
}

export function loadDataset(source: DatasetInputSource): DatasetLoadResult {
  const raw = loadRawDataset(source);
  const inputs: CandidatePipelineInput[] = [];
  const errors: string[] = [];

  for (let i = 0; i < raw.length; i++) {
    try {
      inputs.push(parseCandidatePipelineInputValue(raw[i]));
    } catch (err) {
      errors.push(safeDatasetError(i, err));
    }
  }

  if (inputs.length === 0 && raw.length > 0) {
    throw new Error(`All ${raw.length} entries failed validation. First errors: ${errors.slice(0, 3).join("; ")}`);
  }

  return { inputs, totalCount: raw.length, errorCount: errors.length, errors };
}

function loadRawDataset(source: DatasetInputSource): unknown[] {
  const inputFile = source.inputFile?.trim() || null;
  const inputJson = source.inputJson?.trim() || null;

  if (inputFile && inputJson) {
    throw new Error("Only one input source is allowed. Use either --input-file or --input-json.");
  }

  let text: string;
  let label: string;

  if (inputFile) {
    text = readFileSync(inputFile, "utf8");
    label = "input file";
  } else if (inputJson) {
    text = inputJson;
    label = "input JSON";
  } else {
    throw new Error("Dataset input is required. Provide --input-file or --input-json.");
  }

  const items = parseDatasetText(text, label);
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(`${label} must be a non-empty JSON array or JSONL.`);
  }

  return items;
}

function parseDatasetText(text: string, label: string): unknown[] {
  text = text.trim();

  // Try JSON array first
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    throw new Error("not array");
  } catch {
    // Fall through to JSONL
  }

  // JSONL: one JSON object per line
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

  return items;
}

function safeDatasetError(index: number, err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (containsSensitivePattern(raw)) {
    return `Entry ${index}: [已脱敏]`;
  }
  return `Entry ${index}: ${raw}`;
}
