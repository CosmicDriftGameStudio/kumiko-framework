import type { EntityDefinition, FieldDefinition } from "../engine/types";
import {
  boolean,
  integer,
  numeric,
  table as pgTable,
  serial,
  type TableColumns,
  text,
  timestamp,
} from "./dialect";

type ColumnBuilder =
  | ReturnType<typeof text>
  | ReturnType<typeof integer>
  | ReturnType<typeof boolean>
  | ReturnType<typeof numeric>
  | ReturnType<typeof timestamp>
  | ReturnType<typeof serial>;

// Returns column(s) for a field. Most fields return a single entry,
// money returns two (amount + currency), files/images return none.
function fieldToColumns(
  name: string,
  field: FieldDefinition,
  entity: EntityDefinition,
): Record<string, ColumnBuilder> {
  const snakeName = toSnakeCase(name);

  switch (field.type) {
    case "text":
      return { [name]: text(snakeName) };
    case "boolean":
      return {
        [name]:
          field.default !== undefined
            ? boolean(snakeName).default(field.default).notNull()
            : boolean(snakeName),
      };
    case "select":
      return { [name]: text(snakeName) };
    case "number":
      return { [name]: integer(snakeName) };
    case "money":
      return {
        [name]: numeric(snakeName, { precision: 19, scale: 4 }),
        [`${name}Currency`]: text(`${snakeName}_currency`).default(entity.defaultCurrency ?? "EUR"),
      };
    case "date":
      return { [name]: timestamp(snakeName) };
    case "file":
    case "image":
      // Single file: stores fileRefId as integer
      return { [name]: integer(snakeName) };
    case "files":
    case "images":
      // Multi file: no column in entity table, resolved via FileRef table
      return {};
  }
}

export function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Derives a table name from an entity name:
 * 1. camelCase → snake_case (e.g. "memberTask" → "member_task")
 * 2. Simple English pluralization (category→categories, status→statuses, task→tasks)
 */
export function toTableName(entityName: string): string {
  const snake = toSnakeCase(entityName);
  if (snake.endsWith("y") && !/[aeiou]y$/.test(snake)) {
    return `${snake.slice(0, -1)}ies`;
  }
  if (snake.endsWith("s") || snake.endsWith("sh") || snake.endsWith("ch") || snake.endsWith("x")) {
    return `${snake}es`;
  }
  return `${snake}s`;
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
  entityName: string,
  entity: EntityDefinition,
  options?: { featureName?: string },
): DrizzleTable {
  const baseColumns = buildBaseColumns(entity.softDelete ?? false);
  const fieldColumns: Record<string, ColumnBuilder> = {};

  for (const [name, field] of Object.entries(entity.fields)) {
    const cols = fieldToColumns(name, field, entity);
    Object.assign(fieldColumns, cols);
  }

  // Default table name derived from entityName (e.g. "memberTask" → "member_tasks")
  const baseTableName = entity.table ?? toTableName(entityName);
  const tableName = options?.featureName
    ? `${options.featureName}_${baseTableName}`
    : baseTableName;

  return pgTable(tableName, {
    ...baseColumns,
    ...fieldColumns,
  });
}
