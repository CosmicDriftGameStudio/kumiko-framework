import { camelCase as envCamelCase } from "../env/index.ts";
import type { TableLike } from "./query.ts";
import { toSnakeCase } from "./table-builder.ts";
import { asEntityTableMeta } from "./table-introspection.ts";

// Idempotent snake_case → camelCase. `env.camelCase` always lowercases first
// (designed for SHOUT_CASE input) — for already-camelCase keys (mock rows
// in tests, projection-aliased columns) it would silently produce "tenantid"
// instead of leaving "tenantId" alone. Guard with an underscore check so
// the conversion only fires when the key is actually snake-shaped.
function snakeToCamel(key: string): string {
  if (!key.includes("_")) return key;
  return envCamelCase(key);
}

export type TableInfo = {
  readonly name: string;
  // field name (camelCase or snake_case) → snake_case column name
  readonly columnOf: (field: string) => string;
  // pgType per column-name, for jsonb-cast detection
  readonly pgTypeOf: (column: string) => string | undefined;
  // bigint/bigserial JS round-trip mode per DB column name
  readonly bigintJsModeOf: (column: string) => "number" | "bigint" | undefined;
  // Inverse of columnOf — snake_case DB column → JS field-name (camelCase).
  // Used at the result boundary to rename row keys back to the API shape
  // that callers consume (`row.aggregateId` instead of `row.aggregate_id`).
  readonly fieldOf: (column: string) => string;
  // Check if a field name or column name is known to this table
  readonly hasColumn: (fieldOrColumn: string) => boolean;
};

export function extractTableInfo(table: TableLike): TableInfo {
  const meta = asEntityTableMeta(table);
  if (!meta) {
    throw new Error(
      "extractTableInfo: table is not a kumiko EntityTableMeta — " +
        "build it via buildEntityTable / deriveEntityTableMeta / table().",
    );
  }
  const colByField = new Map<string, string>();
  const fieldByCol = new Map<string, string>();
  const typeByCol = new Map<string, string>();
  const bigintModeByCol = new Map<string, "number" | "bigint">();
  for (const c of meta.columns) {
    typeByCol.set(c.name, c.pgType);
    if (c.bigintJsMode !== undefined) bigintModeByCol.set(c.name, c.bigintJsMode);
    // EntityTableMeta column names are snake_case. Map snake → snake AND
    // derive a camelCase JS field-name so result rows can be renamed back
    // to the API shape (`aggregate_id` → `aggregateId`).
    colByField.set(c.name, c.name);
    const camel = snakeToCamel(c.name);
    if (camel !== c.name) colByField.set(camel, c.name);
    fieldByCol.set(c.name, camel === c.name ? c.name : camel);
  }
  return {
    name: meta.tableName,
    columnOf: (field) => colByField.get(field) ?? toSnakeCase(field),
    pgTypeOf: (col) => typeByCol.get(col),
    bigintJsModeOf: (col) => bigintModeByCol.get(col),
    fieldOf: (col) => fieldByCol.get(col) ?? snakeToCamel(col),
    hasColumn: (fieldOrColumn) => colByField.has(fieldOrColumn) || fieldByCol.has(fieldOrColumn),
  };
}
