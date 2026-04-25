import { TABLE_MAP, type FieldDef } from "./schema.js";

export class RecordValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordValueError";
  }
}

const RECORD_ID_PATTERN = /^rec[a-zA-Z0-9_]+$/;

export function isLarkRecordId(value: string): boolean {
  return RECORD_ID_PATTERN.test(value);
}

export function assertLarkRecordId(label: string, value: string): void {
  if (!isLarkRecordId(value)) {
    throw new RecordValueError(
      `${label} requires a Lark record ID (rec_xxx), got "${value}"`,
    );
  }
}

function assertValidLinkValue(
  fieldName: string,
  value: unknown,
): void {
  if (value === null || value === undefined) return;

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item !== "object" || item === null || !("id" in item)) {
        throw new RecordValueError(
          `Link field "${fieldName}" expects each item to be { id: "rec_xxx" }`,
        );
      }
      const id = (item as { id: unknown }).id;
      if (typeof id !== "string") {
        throw new RecordValueError(
          `Link field "${fieldName}" expects string record IDs, got ${typeof id}`,
        );
      }
      if (!isLarkRecordId(id)) {
        throw new RecordValueError(
          `Link field "${fieldName}" requires record IDs (rec_xxx), got application ID: "${id}"`,
        );
      }
    }
    return;
  }

  if (typeof value === "string") {
    if (!isLarkRecordId(value)) {
      throw new RecordValueError(
        `Link field "${fieldName}" requires record IDs (rec_xxx), got application ID: "${value}"`,
      );
    }
    return;
  }

  throw new RecordValueError(
    `Link field "${fieldName}" expects [{ id: "rec_xxx" }] or null, got ${typeof value}`,
  );
}

function formatLinkValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    const result: Array<{ id: string }> = [];
    for (const item of value) {
      result.push({ id: (item as { id: string }).id });
    }
    return result;
  }
  if (typeof value === "string" && isLarkRecordId(value)) {
    return [{ id: value }];
  }
  return null;
}

export function buildRecordPayload(
  tableName: string,
  record: Record<string, unknown>,
): Record<string, unknown> {
  const table = TABLE_MAP.get(tableName);
  if (!table) {
    throw new RecordValueError(`Unknown table name: "${tableName}"`);
  }

  const fieldMap = new Map(table.fields.map((f) => [f.name, f]));
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (value === null || value === undefined) continue;

    const fieldDef = fieldMap.get(key);

    if (!fieldDef) {
      throw new RecordValueError(
        `Unknown field "${key}" in table "${table.name}"`,
      );
    }

    result[key] = coerceFieldValue(fieldDef, key, value);
  }

  return result;
}

function coerceFieldValue(
  field: FieldDef,
  fieldName: string,
  value: unknown,
): unknown {
  switch (field.type) {
    case "text":
    case "url":
      if (typeof value !== "string") {
        throw new RecordValueError(
          `Field "${fieldName}" expects string, got ${typeof value}`,
        );
      }
      return value;

    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new RecordValueError(
          `Field "${fieldName}" expects finite number, got ${value}`,
        );
      }
      return value;

    case "select":
      if (typeof value !== "string") {
        throw new RecordValueError(
          `Field "${fieldName}" expects string (option name), got ${typeof value}`,
        );
      }
      if (field.options && !field.options.includes(value)) {
        throw new RecordValueError(
          `Field "${fieldName}" received unknown option "${value}"`,
        );
      }
      return value;

    case "date":
      if (typeof value !== "string") {
        throw new RecordValueError(
          `Field "${fieldName}" expects datetime string, got ${typeof value}`,
        );
      }
      return value;

    case "checkbox":
      if (typeof value !== "boolean") {
        throw new RecordValueError(
          `Field "${fieldName}" expects boolean, got ${typeof value}`,
        );
      }
      return value;

    case "link":
      assertValidLinkValue(fieldName, value);
      return formatLinkValue(value);

    default:
      throw new RecordValueError(
        `Field type "${field.type}" is not supported for record values`,
      );
  }
}
