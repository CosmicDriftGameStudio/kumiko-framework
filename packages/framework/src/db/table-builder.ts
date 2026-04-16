import { sql } from "drizzle-orm";
import type { EntityDefinition, EntityRelations, FieldDefinition } from "../engine/types";
import {
  boolean,
  index,
  integer,
  jsonb,
  moneyAmount,
  table as pgTable,
  serial,
  type TableColumns,
  text,
  timestamp,
  uuid,
} from "./dialect";

type ColumnBuilder =
  | ReturnType<typeof text>
  | ReturnType<typeof integer>
  | ReturnType<typeof boolean>
  | ReturnType<typeof moneyAmount>
  | ReturnType<typeof jsonb>
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
      // BIGINT storing the integer minor unit (cents for EUR, yen for JPY —
      // the currency column tells you which). INTEGER would cap at ~21 M EUR
      // which is too tight for B2B invoices, property values or balance
      // aggregates. BIGINT handles up to ~90 trillion EUR safely in JS.
      return {
        [name]: moneyAmount(snakeName),
        [`${name}Currency`]: text(`${snakeName}_currency`).default(entity.defaultCurrency ?? "EUR"),
      };
    case "embedded":
      return { [name]: jsonb(snakeName).default({}) };
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

export function buildBaseColumns(softDelete: boolean, idType: "serial" | "uuid" = "serial") {
  const idColumn =
    idType === "uuid"
      ? uuid("id").primaryKey().default(sql`gen_random_uuid()`)
      : serial("id").primaryKey();

  const base = {
    id: idColumn,
    tenantId: uuid("tenant_id").notNull(),
    version: integer("version").default(1).notNull(),
    insertedAt: timestamp("inserted_at").defaultNow().notNull(),
    modifiedAt: timestamp("modified_at"),
    // User-IDs are stringified UUIDs post-ES migration. Text (not uuid) so the
    // columns accept system actors ("SYSTEM", "SEED", etc.) and legacy-shaped
    // integer ids during transitional tests.
    insertedById: text("inserted_by_id"),
    modifiedById: text("modified_by_id"),
  };

  if (softDelete) {
    return {
      ...base,
      isDeleted: boolean("is_deleted").default(false).notNull(),
      deletedAt: timestamp("deleted_at"),
      deletedById: text("deleted_by_id"),
    };
  }

  return base;
}

export type BuildDrizzleTableOptions = {
  readonly featureName?: string;
  // Relations declared for this entity. When present, every belongsTo
  // foreignKey gets an index — otherwise joins and `WHERE fk = ?` filters
  // sequential-scan the child table. Pass the output of
  // `registry.getRelations(entityName)` or the raw relations block.
  readonly relations?: EntityRelations;
};

export function buildDrizzleTable(
  entityName: string,
  entity: EntityDefinition,
  options?: BuildDrizzleTableOptions,
): DrizzleTable {
  const baseColumns = buildBaseColumns(entity.softDelete ?? false, entity.idType ?? "serial");
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

  // Build the list of foreign-key columns to index. Sources:
  //  (a) single-file / single-image fields store a fileRef id and are queried
  //      by that id whenever a detail view resolves attachments.
  //  (b) belongsTo relations declared via r.relation() — the FK column is the
  //      parent-side lookup key; without an index every child join scans the
  //      full table.
  // `Set` keeps the list deduplicated when (a) and (b) name the same column.
  const foreignKeyFields = new Set<string>();
  for (const [name, field] of Object.entries(entity.fields)) {
    if (field.type === "file" || field.type === "image") {
      foreignKeyFields.add(name);
    }
  }
  if (options?.relations) {
    for (const rel of Object.values(options.relations)) {
      if (rel.type === "belongsTo") foreignKeyFields.add(rel.foreignKey);
    }
  }

  return pgTable(
    tableName,
    {
      ...baseColumns,
      ...fieldColumns,
    },
    // Every multi-tenant query filters by tenant_id. Without this index, list
    // queries scan the whole table across all tenants. Applies to every table
    // built via buildDrizzleTable since every entity inherits tenantId.
    // biome-ignore lint/suspicious/noExplicitAny: Drizzle's table callback is generic; we access columns by their JS property name.
    (table: any) => {
      const indexes = [index(`${tableName}_tenant_id_idx`).on(table.tenantId)];
      for (const fieldName of foreignKeyFields) {
        const column = table[fieldName];
        if (column) {
          indexes.push(index(`${tableName}_${toSnakeCase(fieldName)}_idx`).on(column));
        }
      }
      return indexes;
    },
  );
}
