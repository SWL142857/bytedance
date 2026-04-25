import type { BaseCommandSpec } from "./commands.js";
import { TABLE_MAP } from "./schema.js";
import type { CandidateStatus } from "../types/state.js";

const BASE_TOKEN_PLACEHOLDER = "<BASE_APP_TOKEN>";

function resolveDisplayName(tableName: string): string {
  const table = TABLE_MAP.get(tableName);
  if (!table) {
    throw new Error(`Unknown table name: "${tableName}"`);
  }
  return table.name;
}

export interface ListOptions {
  offset?: number;
  limit?: number;
  viewId?: string;
}

function validateListOptions(options?: ListOptions): {
  offset: number;
  limit: number;
  viewId?: string;
} {
  const offset = options?.offset ?? 0;
  const limit = options?.limit ?? 100;

  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error(`record-list offset must be a non-negative integer, got ${offset}`);
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new Error(`record-list limit must be an integer between 1 and 200, got ${limit}`);
  }
  if (options?.viewId !== undefined && options.viewId.trim() === "") {
    throw new Error("record-list viewId cannot be empty");
  }

  return options?.viewId
    ? { offset, limit, viewId: options.viewId }
    : { offset, limit };
}

function buildListRecordsCommand(
  tableName: string,
  options?: ListOptions,
): BaseCommandSpec {
  const displayName = resolveDisplayName(tableName);
  const { offset, limit, viewId } = validateListOptions(options);

  const args = [
    "base",
    "+record-list",
    "--base-token",
    BASE_TOKEN_PLACEHOLDER,
    "--table-id",
    displayName,
  ];
  if (viewId) {
    args.push("--view-id", viewId);
  }
  args.push("--offset", String(offset), "--limit", String(limit));
  const redactedArgs = [...args];

  return {
    description: `List records from table "${displayName}" (offset=${offset}, limit=${limit})`,
    command: "lark-cli",
    args,
    redactedArgs,
    needsBaseToken: true,
    writesRemote: false,
  };
}

/** List candidates — caller must filter by status client-side */
export function listCandidatesForStatusFilter(
  status: CandidateStatus,
  options?: ListOptions,
): BaseCommandSpec {
  const cmd = buildListRecordsCommand("candidates", options);
  return {
    ...cmd,
    description: `List candidates for client-side status filter "${status}"`,
  };
}

/** List jobs — caller must filter by open status client-side */
export function listJobsForOpenFilter(
  options?: ListOptions,
): BaseCommandSpec {
  const cmd = buildListRecordsCommand("jobs", options);
  return {
    ...cmd,
    description: "List jobs for client-side open-status filter",
  };
}

/** List agent runs — caller must filter by entity type/ref client-side */
export function listAgentRunsForEntityFilter(
  entityType: string,
  entityRef: string,
  options?: ListOptions,
): BaseCommandSpec {
  const cmd = buildListRecordsCommand("agent_runs", options);
  return {
    ...cmd,
    description: `List agent runs for client-side entity filter ${entityType} "${entityRef}"`,
  };
}

export { buildListRecordsCommand };
