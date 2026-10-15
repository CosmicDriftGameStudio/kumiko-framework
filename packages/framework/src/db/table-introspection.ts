import type { EntityTableMeta } from "@cosmicdrift/kumiko-types/entity-table-meta-types";
import {
  KUMIKO_COLUMNS_SYMBOL,
  KUMIKO_META_SYMBOL,
  KUMIKO_NAME_SYMBOL,
} from "@cosmicdrift/kumiko-types/schema-table-types";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";

// table() spreads column handles onto the table object as enumerable props, so
// an entity field named `source`/`columns`/`tableName`/… shadows the matching
// meta key. The symbol-keyed slots are the only collision-safe source; plain
// metas (deriveEntityTableMeta / defineUnmanagedTable) carry no handle spread
// and are unshadowable by their structural shape.

export function isEntityTableMeta(value: unknown): value is EntityTableMeta {
  return (
    typeof value === "object" &&
    value !== null &&
    "tableName" in value &&
    typeof value.tableName === "string" &&
    "columns" in value &&
    Array.isArray(value.columns) &&
    "indexes" in value &&
    Array.isArray(value.indexes) &&
    "source" in value &&
    (value.source === "managed" || value.source === "unmanaged")
  );
}

export function asEntityTableMeta(table: unknown): EntityTableMeta | undefined {
  if (typeof table !== "object" || table === null) return undefined;
  if (KUMIKO_META_SYMBOL in table && isEntityTableMeta(table[KUMIKO_META_SYMBOL])) {
    return table[KUMIKO_META_SYMBOL];
  }
  return isEntityTableMeta(table) ? table : undefined;
}

export function requireEntityTableMeta(table: unknown, tableName: string): EntityTableMeta {
  const meta = asEntityTableMeta(table);
  if (!meta) {
    throw new Error(`${tableName}: table carries no EntityTableMeta — built via table()?`);
  }
  return meta;
}

/** Physical table name from the unshadowable name symbol; undefined when absent. */
export function schemaTableName(table: unknown): string | undefined {
  if (typeof table !== "object" || table === null || !(KUMIKO_NAME_SYMBOL in table)) {
    return undefined;
  }
  const name = table[KUMIKO_NAME_SYMBOL];
  return typeof name === "string" ? name : undefined;
}

/** Name symbol first, then the canonical meta; "<unknown>" when neither resolves. */
export function tableNameOf(table: unknown): string {
  return schemaTableName(table) ?? asEntityTableMeta(table)?.tableName ?? "<unknown>";
}

/** Column-handle map stamped by table(); undefined for tables without one. */
export function tableColumnsOf(table: unknown): Record<string, unknown> | undefined {
  if (typeof table !== "object" || table === null || !(KUMIKO_COLUMNS_SYMBOL in table)) {
    return undefined;
  }
  const columns = table[KUMIKO_COLUMNS_SYMBOL];
  return isPlainObject(columns) ? columns : undefined;
}

/** SQL name carried by the enumerable column handle `table[field]`; undefined when the field has none. */
export function columnHandleName(table: unknown, field: string): string | undefined {
  if (!isPlainObject(table)) return undefined;
  const handle = table[field];
  if (!isPlainObject(handle)) return undefined;
  const name = handle["name"];
  return typeof name === "string" ? name : undefined;
}

/** True when `table[field]` is defined, i.e. the table exposes a column handle (or plain value) for the field. */
export function hasFieldProperty(table: unknown, field: string): boolean {
  return isPlainObject(table) && table[field] !== undefined;
}

/** SQL column name of a JS field via the column-handle map; undefined when not mapped. */
export function columnSqlNameOf(table: unknown, field: string): string | undefined {
  const handle = tableColumnsOf(table)?.[field];
  if (!isPlainObject(handle)) return undefined;
  const name = handle["name"];
  return typeof name === "string" ? name : undefined;
}
