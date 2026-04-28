import { spawnSync } from "node:child_process";
import type { BaseCommandSpec, PlanResult } from "./commands.js";
import { injectBaseToken, validateExecutablePlan, ExecutionBlockedError as PlanExecutionBlockedError } from "./commands.js";
import type { HireLoopConfig } from "../config.js";
import { validateExecutionConfig, redactConfig } from "../config.js";

export type CommandResultStatus = "planned" | "skipped" | "success" | "failed";
export type RunMode = "dry_run" | "execute";

export interface CommandResult {
  description: string;
  status: CommandResultStatus;
  stdout: string | null;
  stderr: string | null;
  exitCode: number | null;
  durationMs: number;
}

export interface RunResult {
  mode: RunMode;
  results: CommandResult[];
  totalDurationMs: number;
  blocked: boolean;
}

export class ExecutionBlockedError extends Error {
  constructor(
    public readonly validationErrors: Array<{ field: string; message: string }>,
  ) {
    super(
      `Execution blocked: ${validationErrors.map((e) => e.field).join(", ")}`,
    );
    this.name = "ExecutionBlockedError";
  }
}

export interface RunPlanOptions {
  plan: PlanResult;
  config: HireLoopConfig;
  execute: boolean;
}

export function runPlan(options: RunPlanOptions): RunResult {
  const { plan, config, execute } = options;
  const mode: RunMode = execute ? "execute" : "dry_run";

  if (execute) {
    try {
      validateExecutablePlan(plan);
    } catch (err) {
      if (err instanceof PlanExecutionBlockedError) {
        console.error("Execution blocked: plan contains unsupported fields.");
        for (const uf of err.unsupportedFields) {
          console.error(`  - ${uf.tableName}.${uf.fieldName}: ${uf.fieldType} — ${uf.reason}`);
        }
        const results: CommandResult[] = plan.commands.map((spec) => ({
          description: spec.description,
          status: "skipped",
          stdout: null,
          stderr: null,
          exitCode: null,
          durationMs: 0,
        }));
        return { mode, results, totalDurationMs: 0, blocked: true };
      }
      throw err;
    }
  }

  return runCommands(plan.commands, config, execute);
}

function runCommands(
  specs: BaseCommandSpec[],
  config: HireLoopConfig,
  execute: boolean = false,
): RunResult {
  const mode: RunMode = execute ? "execute" : "dry_run";
  const results: CommandResult[] = [];
  const startTime = Date.now();

  if (execute) {
    if (!config.allowLarkWrite) {
      validateExecutionConfig(config);
      console.error("Execution blocked: HIRELOOP_ALLOW_LARK_WRITE is not set to 1");
      console.error("Redacted config:", JSON.stringify(redactConfig(config), null, 2));
      for (const spec of specs) {
        results.push({
          description: spec.description,
          status: "skipped",
          stdout: null,
          stderr: null,
          exitCode: null,
          durationMs: 0,
        });
      }
      return { mode, results, totalDurationMs: Date.now() - startTime, blocked: true };
    }

    const errors = validateExecutionConfig(config);
    if (errors.length > 0) {
      console.error("Execution blocked due to invalid config:");
      for (const err of errors) {
        console.error(`  - ${err.field}: ${err.message}`);
      }
      console.error("Redacted config:", JSON.stringify(redactConfig(config), null, 2));
      for (const spec of specs) {
        results.push({
          description: spec.description,
          status: "skipped",
          stdout: null,
          stderr: null,
          exitCode: null,
          durationMs: 0,
        });
      }
      return { mode, results, totalDurationMs: Date.now() - startTime, blocked: true };
    }
  }

  for (const spec of specs) {
    if (!execute) {
      results.push({
        description: spec.description,
        status: "planned",
        stdout: null,
        stderr: null,
        exitCode: null,
        durationMs: 0,
      });
      console.log(`[PLANNED] ${spec.description}`);
      console.log(`  Command: ${spec.redactedArgs.join(" ")}`);
      continue;
    }

    const baseToken = config.baseAppToken;
    if (!baseToken) {
      results.push({
        description: spec.description,
        status: "skipped",
        stdout: null,
        stderr: "Missing BASE_APP_TOKEN",
        exitCode: null,
        durationMs: 0,
      });
      continue;
    }

    const { command, args } = injectBaseToken(spec, baseToken);
    const cmdStart = Date.now();
    console.log(`[EXECUTING] ${spec.description}`);

    const result = spawnSync(command, args, {
      timeout: 30000,
      encoding: "utf-8",
    });

    const durationMs = Date.now() - cmdStart;
    const exitCode = result.status ?? null;
    const stdout = result.stdout ?? null;
    const stderr = result.stderr ?? null;

    const status: CommandResultStatus = exitCode === 0 ? "success" : "failed";

    if (status === "failed") {
      console.error(`[FAILED] ${spec.description}`);
      if (stderr) console.error(`  stderr: ${stderr}`);
    } else {
      console.log(`[SUCCESS] ${spec.description}`);
    }

    results.push({
      description: spec.description,
      status,
      stdout,
      stderr,
      exitCode,
      durationMs,
    });

    if (status === "failed") {
      console.error(`Aborting: command "${spec.description}" failed with exit code ${exitCode}`);
      break;
    }
  }

  return {
    mode,
    results,
    totalDurationMs: Date.now() - startTime,
    blocked: false,
  };
}

export class OutputParseError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "OutputParseError";
  }
}

export function safeParseJson(stdout: string | null): unknown {
  if (!stdout) {
    throw new OutputParseError("stdout is empty");
  }

  const redacted = stdout.replace(
    /app_[a-zA-Z0-9]+/g,
    "<REDACTED_TOKEN>",
  );

  try {
    return JSON.parse(redacted);
  } catch (err) {
    throw new OutputParseError(
      `Failed to parse stdout as JSON (redacted): ${redacted.slice(0, 200)}`,
      err,
    );
  }
}

export interface RecordListResult {
  records: Array<{ id: string; fields: Record<string, unknown> }>;
  total?: number;
  hasMore?: boolean;
}

export function parseRecordList(stdout: string | null): RecordListResult {
  const parsed = safeParseJson(stdout);

  if (typeof parsed !== "object" || parsed === null) {
    throw new OutputParseError("Expected JSON object in record list output");
  }

  const obj = parsed as Record<string, unknown>;
  const data = (typeof obj.data === "object" && obj.data !== null)
    ? obj.data as Record<string, unknown>
    : null;
  const tabularRecords = parseTabularRecordList(data);
  if (tabularRecords) {
    return tabularRecords;
  }

  const items = obj.items ?? data?.items;
  const totalValue = obj.total ?? data?.total;
  const hasMoreValue = obj.has_more ?? data?.has_more;
  const total = typeof totalValue === "number" ? totalValue : undefined;
  const hasMore = typeof hasMoreValue === "boolean" ? hasMoreValue : undefined;

  if (!Array.isArray(items)) {
    throw new OutputParseError(
      `Expected "items" array in record list, got ${typeof items}`,
    );
  }

  const records = items.map((item: unknown) => {
    if (typeof item !== "object" || item === null) {
      throw new OutputParseError("Record item is not an object");
    }
    const record = item as Record<string, unknown>;
    const recordId = record.id ?? record.record_id;
    if (typeof recordId !== "string") {
      throw new OutputParseError("Record item missing string \"id\" or \"record_id\"");
    }
    const fields = record.fields;
    if (fields === undefined || fields === null) {
      throw new OutputParseError(`Record "${recordId}" missing "fields"`);
    }
    if (typeof fields !== "object" || Array.isArray(fields)) {
      throw new OutputParseError(`Record "${recordId}" has non-object "fields": ${typeof fields}`);
    }
    return {
      id: recordId,
      fields: fields as Record<string, unknown>,
    };
  });

  return { records, total, hasMore };
}

function normalizeTabularFieldName(field: unknown): string | null {
  if (typeof field === "string" && field.length > 0) return field;
  if (typeof field !== "object" || field === null) return null;

  const obj = field as Record<string, unknown>;
  const name = obj.field_name ?? obj.name ?? obj.fieldName;
  return typeof name === "string" && name.length > 0 ? name : null;
}

function getTabularCell(row: unknown, index: number): unknown {
  if (Array.isArray(row)) return row[index];
  if (typeof row === "object" && row !== null) {
    return (row as Record<string, unknown>)[String(index)];
  }
  return undefined;
}

function parseTabularRecordList(data: Record<string, unknown> | null): RecordListResult | null {
  if (!data) return null;
  if (!Array.isArray(data.data) || !Array.isArray(data.fields) || !Array.isArray(data.record_id_list)) {
    return null;
  }

  const fieldNames = data.fields.map(normalizeTabularFieldName);
  const rows = data.data;
  const recordIds = data.record_id_list;
  const records = rows.map((row: unknown, rowIndex: number) => {
    const recordId = recordIds[rowIndex];
    if (typeof recordId !== "string") {
      throw new OutputParseError(`Tabular record at index ${rowIndex} missing record_id_list entry`);
    }

    const fields: Record<string, unknown> = {};
    fieldNames.forEach((fieldName, fieldIndex) => {
      if (fieldName) fields[fieldName] = getTabularCell(row, fieldIndex);
    });

    return { id: recordId, fields };
  });

  const totalValue = data.total ?? rows.length;
  const hasMoreValue = data.has_more;
  const total = typeof totalValue === "number" ? totalValue : rows.length;
  const hasMore = typeof hasMoreValue === "boolean" ? hasMoreValue : undefined;

  return { records, total, hasMore };
}
