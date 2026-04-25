import type { FieldDef, FieldType, TableDef } from "./schema.js";
import { TABLE_MAP } from "./schema.js";

export interface LarkFieldJson {
  name: string;
  type: string;
  style?: { format?: string; type?: string };
  multiple?: boolean;
  options?: Array<{ name: string }>;
  link_table?: string;
  bidirectional?: boolean;
  bidirectional_link_field_name?: string;
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

export interface FieldMappingContext {
  sourceTable: TableDef;
}

export function mapFieldDef(
  field: FieldDef,
  context?: FieldMappingContext,
): FieldMappingResult {
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
        supported: true,
        fieldJson: {
          name: field.name,
          type: "datetime",
          style: { format: "yyyy-MM-dd HH:mm" },
        },
      };

    case "checkbox":
      return {
        supported: true,
        fieldJson: {
          name: field.name,
          type: "checkbox",
        },
      };

    case "url":
      return {
        supported: true,
        fieldJson: {
          name: field.name,
          type: "text",
          style: { type: "url" },
        },
      };

    case "link":
      if (!field.linkTo) {
        return {
          supported: false,
          fieldType: field.type,
          fieldName: field.name,
          reason: "Link field missing required \"linkTo\" property",
        };
      }
      const targetTable = TABLE_MAP.get(field.linkTo);
      if (!targetTable) {
        return {
          supported: false,
          fieldType: field.type,
          fieldName: field.name,
          reason: `Link field references unknown table "${field.linkTo}"`,
        };
      }
      if (!context) {
        return {
          supported: false,
          fieldType: field.type,
          fieldName: field.name,
          reason: "Link field mapping requires source table context",
        };
      }
      return {
        supported: true,
        fieldJson: {
          name: field.name,
          type: "link",
          link_table: targetTable.name,
          bidirectional: true,
          bidirectional_link_field_name: context.sourceTable.name,
        },
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
