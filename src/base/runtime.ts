import { TABLE_MAP } from "./schema.js";
import { assertLarkRecordId, buildRecordPayload, RecordValueError } from "./record-values.js";
import { buildListRecordsCommand, type ListOptions } from "./queries.js";
import type { BaseCommandSpec, PlanResult } from "./commands.js";
import type { CandidateStatus } from "../types/state.js";
import { assertTransition, type ActorType } from "../orchestrator/state-machine.js";

const BASE_TOKEN_PLACEHOLDER = "<BASE_APP_TOKEN>";

export interface AgentRunRecord {
  run_id: string;
  agent_name: string;
  entity_type: string;
  entity_ref: string;
  input_summary: string;
  output_json?: string;
  prompt_template_id: string;
  git_commit_hash: string;
  prompt_hash?: string;
  status_before?: CandidateStatus;
  status_after?: CandidateStatus;
  run_status: "success" | "failed" | "retried" | "skipped";
  error_message?: string;
  retry_count: number;
  duration_ms: number;
}

function resolveDisplayName(tableName: string): string {
  const table = TABLE_MAP.get(tableName);
  if (!table) {
    throw new RecordValueError(`Unknown table name: "${tableName}"`);
  }
  return table.name;
}

function buildUpsertCommand(
  tableName: string,
  record: Record<string, unknown>,
  recordId?: string,
): BaseCommandSpec {
  const displayName = resolveDisplayName(tableName);
  if (recordId) {
    assertLarkRecordId("recordId", recordId);
  }
  const payload = buildRecordPayload(tableName, record);
  const recordJsonStr = JSON.stringify(payload);

  const args = [
    "base",
    "+record-upsert",
    "--base-token",
    BASE_TOKEN_PLACEHOLDER,
    "--table-id",
    displayName,
  ];
  if (recordId) {
    args.push("--record-id", recordId);
  }
  args.push("--json", recordJsonStr);
  const redactedArgs = [...args];

  return {
    description: `Upsert record into "${displayName}"`,
    command: "lark-cli",
    args,
    redactedArgs,
    needsBaseToken: true,
    writesRemote: true,
  };
}

export function listRecords(
  tableName: string,
  options?: ListOptions,
): BaseCommandSpec {
  return buildListRecordsCommand(tableName, options);
}

export function upsertRecord(
  tableName: string,
  record: Record<string, unknown>,
  options?: { recordId?: string },
): BaseCommandSpec {
  return buildUpsertCommand(tableName, record, options?.recordId);
}

export interface CandidateStatusUpdate {
  candidateRecordId: string;
  fromStatus: CandidateStatus;
  toStatus: CandidateStatus;
  actor: ActorType;
}

export function updateCandidateStatus(
  update: CandidateStatusUpdate,
): BaseCommandSpec {
  assertTransition(update.fromStatus, update.toStatus, update.actor);
  assertLarkRecordId("candidateRecordId", update.candidateRecordId);
  const command = buildUpsertCommand(
    "candidates",
    { status: update.toStatus },
    update.candidateRecordId,
  );

  return {
    ...command,
    description: `Update candidate status: ${update.fromStatus} -> ${update.toStatus} (${update.actor})`,
  };
}

export function appendAgentRun(
  run: AgentRunRecord,
): BaseCommandSpec {
  return buildUpsertCommand("agent_runs", run as unknown as Record<string, unknown>);
}

export function planFromCommands(commands: BaseCommandSpec[]): PlanResult {
  return { commands, unsupportedFields: [] };
}
