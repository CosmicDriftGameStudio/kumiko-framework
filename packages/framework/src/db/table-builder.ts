import type { EntityDefinition, FieldDefinition } from "../engine/types";
import {
  boolean,
  integer,
  table as pgTable,
  serial,
  type TableColumns,
  text,
  timestamp,
} from "./dialect";

function fieldToColumn(name: string, field: FieldDefinition) {
  const snakeName = toSnakeCase(name);

  switch (field.type) {
    case "text":
      return text(snakeName);
    case "boolean":
      return field.default !== undefined
        ? boolean(snakeName).default(field.default).notNull()
        : boolean(snakeName);
    case "select":
      return text(snakeName);
    case "number":
      return integer(snakeName);
    case "date":
      return timestamp(snakeName);
    case "file":
    case "image":
      // Single file: stores fileRefId as integer
      return integer(snakeName);
    case "files":
    case "images":
      // Multi file: no column in entity table, resolved via FileRef table
      return null;
  }
}

function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

// biome-ignore lint/suspicious/noExplicitAny: Drizzle dynamic tables lose column types
type DrizzleTable = TableColumns<any>;

export function buildBaseColumns(softDelete: boolean) {
  const base = {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").notNull(),
    version: integer("version").default(1).notNull(),
    insertedAt: timestamp("inserted_at").defaultNow().notNull(),
    modifiedAt: timestamp("modified_at"),
    insertedById: integer("inserted_by_id"),
    modifiedById: integer("modified_by_id"),
  };

  if (softDelete) {
    return {
      ...base,
      isDeleted: boolean("is_deleted").default(false).notNull(),
      deletedAt: timestamp("deleted_at"),
      deletedById: integer("deleted_by_id"),
    };
  }

  return base;
}

export function buildDrizzleTable(
  _entityName: string,
  entity: EntityDefinition,
  options?: { featureName?: string },
): DrizzleTable {
  const baseColumns = buildBaseColumns(entity.softDelete ?? false);
  const fieldColumns: Record<string, ReturnType<typeof fieldToColumn>> = {};

  for (const [name, field] of Object.entries(entity.fields)) {
    const col = fieldToColumn(name, field);
    if (col !== null) {
      fieldColumns[name] = col;
    }
  }

  // Table name: featureName_tableName when feature prefix is provided
  const tableName = options?.featureName ? `${options.featureName}_${entity.table}` : entity.table;

  return pgTable(tableName, {
    ...baseColumns,
    ...fieldColumns,
  });
}
