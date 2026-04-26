import { TABLE_MAP } from "./schema.js";
import { buildListRecordsCommand } from "./queries.js";
import { parseRecordList, type RecordListResult } from "./lark-cli-runner.js";
import type { BaseCommandSpec } from "./commands.js";
import { assertLarkRecordId } from "./record-values.js";

export interface RecordIdentity {
  tableName: string;
  businessField: string;
  businessId: string;
}

export interface ResolvedRecord {
  tableName: string;
  businessField: string;
  businessId: string;
  recordId: string;
}

export interface RecordResolutionPlan {
  commands: BaseCommandSpec[];
  identities: RecordIdentity[];
}

export class RecordResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordResolutionError";
  }
}

export function recordIdentityKey(identity: RecordIdentity): string {
  return `${identity.tableName}:${identity.businessField}:${identity.businessId}`;
}

function validateIdentity(identity: RecordIdentity): void {
  const table = TABLE_MAP.get(identity.tableName);
  if (!table) {
    throw new RecordResolutionError(
      `Unknown table name: "${identity.tableName}"`,
    );
  }

  const fieldDef = table.fields.find((f) => f.name === identity.businessField);
  if (!fieldDef) {
    throw new RecordResolutionError(
      `Unknown field "${identity.businessField}" in table "${table.name}"`,
    );
  }

  if (!identity.businessId || identity.businessId.trim().length === 0) {
    throw new RecordResolutionError(
      `businessId must not be empty for ${table.name}.${identity.businessField}`,
    );
  }
}

function dedupeIdentities(identities: RecordIdentity[]): RecordIdentity[] {
  const dedupedIdentities: RecordIdentity[] = [];
  const seen = new Set<string>();

  for (const identity of identities) {
    validateIdentity(identity);
    const key = recordIdentityKey(identity);
    if (seen.has(key)) continue;
    seen.add(key);
    dedupedIdentities.push(identity);
  }

  return dedupedIdentities;
}

export function buildRecordResolutionPlan(
  identities: RecordIdentity[],
): RecordResolutionPlan {
  if (identities.length === 0) {
    throw new RecordResolutionError("identities must not be empty");
  }

  const dedupedIdentities = dedupeIdentities(identities);
  const commands: BaseCommandSpec[] = dedupedIdentities.map((identity) =>
    buildListRecordsCommand(identity.tableName, { limit: 200 }),
  );

  return { commands, identities: dedupedIdentities };
}

export function resolveRecordFromListOutput(
  identity: RecordIdentity,
  stdout: string | null,
): ResolvedRecord {
  validateIdentity(identity);
  const table = TABLE_MAP.get(identity.tableName);
  if (!table) throw new RecordResolutionError(`Unknown table name: "${identity.tableName}"`);

  let output: RecordListResult;
  try {
    output = parseRecordList(stdout);
  } catch (err) {
    throw new RecordResolutionError(
      `Failed to parse record list output for "${recordIdentityKey(identity)}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const matches = output.records.filter(
    (r) => {
      const val = r.fields[identity.businessField];
      return typeof val === "string" && val === identity.businessId;
    },
  );

  if (matches.length === 0) {
    throw new RecordResolutionError(
      `No record found in "${table.name}" where ${identity.businessField}="${identity.businessId}"`,
    );
  }

  if (matches.length > 1) {
    throw new RecordResolutionError(
      `Multiple records (${matches.length}) found in "${table.name}" where ${identity.businessField}="${identity.businessId}"`,
    );
  }

  const recordId = matches[0]!.id;
  try {
    assertLarkRecordId("recordId", recordId);
  } catch (err) {
    throw new RecordResolutionError(err instanceof Error ? err.message : "Resolved record ID is invalid");
  }

  return {
    tableName: identity.tableName,
    businessField: identity.businessField,
    businessId: identity.businessId,
    recordId,
  };
}

export function resolveRecordsFromOutputs(
  identities: RecordIdentity[],
  stdoutByKey: Record<string, string | null | undefined>,
): ResolvedRecord[] {
  if (identities.length === 0) {
    throw new RecordResolutionError("identities must not be empty");
  }
  const dedupedIdentities = dedupeIdentities(identities);

  const resolved: ResolvedRecord[] = [];

  for (const identity of dedupedIdentities) {
    const key = recordIdentityKey(identity);
    const stdout = stdoutByKey[key];
    if (stdout === undefined) {
      throw new RecordResolutionError(`Missing stdout for identity "${key}"`);
    }
    resolved.push(resolveRecordFromListOutput(identity, stdout));
  }

  return resolved;
}
