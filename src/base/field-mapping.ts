import type { FieldDef, FieldType } from "./schema.js";

export interface LarkFieldJson {
  name: string;
  type: string;
  style?: { type: string };
  multiple?: boolean;
  options?: Array<{ name: string }>;
}

export interface UnsupportedFieldResult {
  supported: false;
  fieldType: FieldType;
  fieldName: string;
  reason: string;
}

export type FieldMappingResult =
  | { supported: true; fieldJson: LarkFieldJson }
  | UnsupportedFieldResult;

export function mapFieldDef(field: FieldDef): FieldMappingResult {
  switch (field.type) {
    case "text":
      return {
        supported: true,
        fieldJson: {
          name: field.name,
          type: "text",
          style: { type: "plain" },
        },
      };

    case "number":
      return {
        supported: true,
        fieldJson: {
          name: field.name,
          type: "number",
          style: { type: "plain" },
        },
      };

    case "select":
      return {
        supported: true,
        fieldJson: {
          name: field.name,
          type: "select",
          multiple: false,
          options: field.options
            ? field.options.map((o) => ({ name: o }))
            : [],
        },
      };

    case "date":
      return {
        supported: false,
        fieldType: field.type,
        fieldName: field.name,
        reason: "Field type \"date\" is not yet supported in lark-cli +field-create shortcut JSON format",
      };

    case "checkbox":
      return {
        supported: false,
        fieldType: field.type,
        fieldName: field.name,
        reason: "Field type \"checkbox\" is not yet supported in lark-cli +field-create shortcut JSON format",
      };

    case "url":
      return {
        supported: false,
        fieldType: field.type,
        fieldName: field.name,
        reason: "Field type \"url\" is not yet supported in lark-cli +field-create shortcut JSON format",
      };

    case "link":
      return {
        supported: false,
        fieldType: field.type,
        fieldName: field.name,
        reason: "Field type \"link\" is not yet supported in lark-cli +field-create shortcut JSON format (requires link_table structure)",
      };

    case "json":
    case "multi_select":
      return {
        supported: false,
        fieldType: field.type,
        fieldName: field.name,
        reason: `Field type "${field.type}" is not yet supported in lark-cli field mapping`,
      };

    default:
      return {
        supported: false,
        fieldType: field.type,
        fieldName: field.name,
        reason: `Unknown field type "${field.type}"`,
      };
  }
}

export function isUnsupported(result: FieldMappingResult): result is UnsupportedFieldResult {
  return !result.supported;
}
