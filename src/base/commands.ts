import type { TableDef, FieldDef } from "./schema.js";
import { ALL_TABLES, TABLE_MAP } from "./schema.js";
import { mapFieldDef, isUnsupported, type FieldMappingContext } from "./field-mapping.js";

export interface BaseCommandSpec {
  description: string;
  command: string;
  args: string[];
  redactedArgs: string[];
  needsBaseToken: boolean;
  writesRemote: boolean;
}

export interface UnsupportedFieldError {
  tableName: string;
  fieldName: string;
  fieldType: string;
  reason: string;
}

export interface PlanResult {
  commands: BaseCommandSpec[];
  unsupportedFields: UnsupportedFieldError[];
}

export class ExecutionBlockedError extends Error {
  constructor(
    public readonly unsupportedFields: UnsupportedFieldError[],
  ) {
    super(
      `Execution blocked: ${unsupportedFields.length} unsupported field(s)`,
    );
    this.name = "ExecutionBlockedError";
  }
}

export function validateExecutablePlan(plan: PlanResult): void {
  if (plan.unsupportedFields.length > 0) {
    throw new ExecutionBlockedError(plan.unsupportedFields);
  }
}

const BASE_TOKEN_PLACEHOLDER = "<BASE_APP_TOKEN>";

function buildTableCreateCommand(table: TableDef): BaseCommandSpec {
  const args = [
    "base",
    "+table-create",
    "--base-token",
    BASE_TOKEN_PLACEHOLDER,
    "--name",
    table.name,
  ];
  const redactedArgs = [
    "base",
    "+table-create",
    "--base-token",
    BASE_TOKEN_PLACEHOLDER,
    "--name",
    table.name,
  ];
  return {
    description: `Create table "${table.name}"`,
    command: "lark-cli",
    args,
    redactedArgs,
    needsBaseToken: true,
    writesRemote: true,
  };
}

function buildFieldCreateCommand(
  table: TableDef,
  field: FieldDef,
  unsupported: UnsupportedFieldError[],
): BaseCommandSpec | null {
  const context: FieldMappingContext = { sourceTable: table };
  const mapping = mapFieldDef(field, context);

  if (isUnsupported(mapping)) {
    unsupported.push({
      tableName: table.name,
      fieldName: field.name,
      fieldType: mapping.fieldType,
      reason: mapping.reason,
    });
    return null;
  }

  const fieldJsonStr = JSON.stringify(mapping.fieldJson);
  const args = [
    "base",
    "+field-create",
    "--base-token",
    BASE_TOKEN_PLACEHOLDER,
    "--table-id",
    table.name,
    "--json",
    fieldJsonStr,
  ];
  const redactedArgs = [
    "base",
    "+field-create",
    "--base-token",
    BASE_TOKEN_PLACEHOLDER,
    "--table-id",
    table.name,
    "--json",
    fieldJsonStr,
  ];

  return {
    description: `Create field "${field.name}" in table "${table.name}"`,
    command: "lark-cli",
    args,
    redactedArgs,
    needsBaseToken: true,
    writesRemote: true,
  };
}

export function generateSetupPlan(): PlanResult {
  const commands: BaseCommandSpec[] = [];
  const unsupportedFields: UnsupportedFieldError[] = [];

  for (const table of ALL_TABLES) {
    commands.push(buildTableCreateCommand(table));

    for (const field of table.fields) {
      const fieldCmd = buildFieldCreateCommand(table, field, unsupportedFields);
      if (fieldCmd) {
        commands.push(fieldCmd);
      }
    }
  }

  return { commands, unsupportedFields };
}

function buildFieldUpdateCommand(
  table: TableDef,
  field: FieldDef,
  unsupported: UnsupportedFieldError[],
): BaseCommandSpec | null {
  const context: FieldMappingContext = { sourceTable: table };
  const mapping = mapFieldDef(field, context);

  if (isUnsupported(mapping)) {
    unsupported.push({
      tableName: table.name,
      fieldName: field.name,
      fieldType: mapping.fieldType,
      reason: mapping.reason,
    });
    return null;
  }

  const fieldJsonStr = JSON.stringify(mapping.fieldJson);
  const args = [
    "base",
    "+field-update",
    "--base-token",
    BASE_TOKEN_PLACEHOLDER,
    "--table-id",
    table.name,
    "--field-id",
    field.name,
    "--json",
    fieldJsonStr,
  ];
  const redactedArgs = [...args];

  return {
    description: `Update field "${field.name}" in table "${table.name}"`,
    command: "lark-cli",
    args,
    redactedArgs,
    needsBaseToken: true,
    writesRemote: true,
  };
}

export function generateSchemaMigrationPlan(): PlanResult {
  const commands: BaseCommandSpec[] = [];
  const unsupportedFields: UnsupportedFieldError[] = [];

  for (const table of ALL_TABLES) {
    for (const field of table.fields) {
      if (field.type !== "select") continue;
      const fieldCmd = buildFieldUpdateCommand(table, field, unsupportedFields);
      if (fieldCmd) {
        commands.push(fieldCmd);
      }
    }
  }

  return { commands, unsupportedFields };
}

export interface SeedData {
  tableName: string;
  displayName: string;
  record: Record<string, unknown>;
}

export function seedFromInternal(tableName: string, record: Record<string, unknown>): SeedData {
  const table = TABLE_MAP.get(tableName);
  if (!table) {
    throw new Error(`Unknown table name: ${tableName}`);
  }
  return { tableName, displayName: table.name, record };
}

export function generateSeedPlan(seeds: SeedData[]): PlanResult {
  const commands: BaseCommandSpec[] = [];
  const unsupportedFields: UnsupportedFieldError[] = [];

  for (const seed of seeds) {
    const recordJsonStr = JSON.stringify(seed.record);
    const args = [
      "base",
      "+record-upsert",
      "--base-token",
      BASE_TOKEN_PLACEHOLDER,
      "--table-id",
      seed.displayName,
      "--json",
      recordJsonStr,
    ];
    const redactedArgs = [
      "base",
      "+record-upsert",
      "--base-token",
      BASE_TOKEN_PLACEHOLDER,
      "--table-id",
      seed.displayName,
      "--json",
      recordJsonStr,
    ];

    commands.push({
      description: `Seed record into table "${seed.displayName}"`,
      command: "lark-cli",
      args,
      redactedArgs,
      needsBaseToken: true,
      writesRemote: true,
    });
  }

  return { commands, unsupportedFields };
}

export function generateFullPlan(seeds: SeedData[]): PlanResult {
  const setupPlan = generateSetupPlan();
  const seedPlan = generateSeedPlan(seeds);

  return {
    commands: [...setupPlan.commands, ...seedPlan.commands],
    unsupportedFields: [...setupPlan.unsupportedFields, ...seedPlan.unsupportedFields],
  };
}

export function injectBaseToken(
  spec: BaseCommandSpec,
  baseToken: string,
): { command: string; args: string[] } {
  if (!spec.needsBaseToken) {
    return { command: spec.command, args: spec.args };
  }
  const args = spec.args.map((arg) =>
    arg === BASE_TOKEN_PLACEHOLDER ? baseToken : arg,
  );
  return { command: spec.command, args };
}
