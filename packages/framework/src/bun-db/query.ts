// Typed Query-API über Bun.sql. KEIN drizzle intern. Identische Signatur
// zur legacy `db/query-api.ts` — App-code-migration ist Import-Pfad-Wechsel,
// kein call-site-Refactor.
//
// API:
//   selectMany<T>(db, table, where?, opts?) → readonly T[]
//   fetchOne<T>(db, table, where) → T | undefined
//   insertOne<T>(db, table, values) → T | undefined
//   updateMany<T>(db, table, set, where) → readonly T[]
//   deleteMany(db, table, where) → void
//   transaction<T>(db, fn) → T
//
// `table` kann sein:
//   - EntityTableMeta (preferred, plain data)
//   - drizzle pgTable (legacy, hat Symbol-based tableName) — extracted via
//     drizzle's getTableName + getTableColumns (drizzle weiterhin als type-
//     reference, NICHT als runtime-API-call)

import { getTableColumns, getTableName } from "drizzle-orm";
import type { EntityTableMeta } from "../db/entity-table-meta";
import { toSnakeCase } from "../db/table-builder";
import type { BunDbRunner } from "./connection";

export type WhereValue = unknown;
export type WhereObject = Record<string, WhereValue>;
export type SelectOptions = {
  readonly limit?: number;
  readonly orderBy?: {
    readonly col: string;
    readonly direction?: "asc" | "desc";
  };
};

// Akzeptiert EITHER. Beide haben einen tableName und field→column-mapping.
// biome-ignore lint/suspicious/noExplicitAny: legacy drizzle pgTable surface
type TableLike = EntityTableMeta | any;

type TableInfo = {
  readonly name: string;
  // field-name (camelCase oder snake_case) → snake_case column-name
  readonly columnOf: (field: string) => string;
  // pgType per column-name, for jsonb-cast detection
  readonly pgTypeOf: (column: string) => string | undefined;
};

function extractTableInfo(table: TableLike): TableInfo {
  // EntityTableMeta discriminator: hat source-property "managed" | "unmanaged"
  if (
    table !== null &&
    typeof table === "object" &&
    "source" in table &&
    (table.source === "managed" || table.source === "unmanaged")
  ) {
    const meta = table as EntityTableMeta;
    const colByField = new Map<string, string>();
    const typeByCol = new Map<string, string>();
    for (const c of meta.columns) {
      typeByCol.set(c.name, c.pgType);
      // EntityTableMeta column names are already snake_case. App-code may
      // pass camelCase keys (z.B. `tenantId`) — convert via toSnakeCase.
      colByField.set(c.name, c.name);
    }
    return {
      name: meta.tableName,
      columnOf: (field) => {
        if (colByField.has(field)) return field;
        const snake = toSnakeCase(field);
        return colByField.has(snake) ? snake : snake;
      },
      pgTypeOf: (col) => typeByCol.get(col),
    };
  }
  // drizzle pgTable: getTableName liefert string, getTableColumns liefert
  // ein Map<field-name, columnObject>. Wir holen das einmal beim Aufruf
  // und cachen die mapping.
  const name = getTableName(table);
  const cols = getTableColumns(table);
  const colByField = new Map<string, string>();
  const typeByCol = new Map<string, string>();
  for (const [field, colObj] of Object.entries(cols)) {
    // drizzle column-objects: .name = DB-column-name (snake_case),
    // .getSQLType() = pg-type string
    const colName = (colObj as { name: string }).name;
    const sqlType = typeof (colObj as { getSQLType?: () => string }).getSQLType === "function"
      ? (colObj as { getSQLType: () => string }).getSQLType()
      : undefined;
    colByField.set(field, colName);
    if (sqlType) typeByCol.set(colName, sqlType);
  }
  return {
    name,
    columnOf: (field) => colByField.get(field) ?? toSnakeCase(field),
    pgTypeOf: (col) => typeByCol.get(col),
  };
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

// Helper für jsonb-Werte: Bun.sql kann arrays/objects nicht direkt als
// jsonb binden — wir JSON.stringify + ::jsonb cast.
function prepareValue(value: unknown, pgType: string | undefined): { sql: string; bound: unknown } {
  if (pgType === "jsonb" && value !== null && typeof value === "object") {
    return { sql: "::jsonb", bound: JSON.stringify(value) };
  }
  return { sql: "", bound: value };
}

function buildWhereClause(
  info: TableInfo,
  where: WhereObject,
  startIndex: number,
): { sqlText: string; values: unknown[] } {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = startIndex;
  for (const [field, value] of Object.entries(where)) {
    const col = info.columnOf(field);
    if (value === null) {
      conditions.push(`${quoteIdent(col)} IS NULL`);
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        conditions.push("FALSE");
      } else {
        const pgType = info.pgTypeOf(col);
        const placeholders = value
          .map(() => {
            const i = idx++;
            return `$${i}`;
          })
          .join(", ");
        conditions.push(`${quoteIdent(col)} IN (${placeholders})`);
        for (const v of value) {
          const p = prepareValue(v, pgType);
          values.push(p.bound);
        }
      }
    } else {
      const pgType = info.pgTypeOf(col);
      const p = prepareValue(value, pgType);
      conditions.push(`${quoteIdent(col)} = $${idx++}${p.sql}`);
      values.push(p.bound);
    }
  }
  return { sqlText: conditions.join(" AND "), values };
}

export async function selectMany<TRow = Record<string, unknown>>(
  db: BunDbRunner,
  table: TableLike,
  where?: WhereObject,
  options?: SelectOptions,
): Promise<readonly TRow[]> {
  const info = extractTableInfo(table);
  let sqlText = `SELECT * FROM ${quoteIdent(info.name)}`;
  let values: unknown[] = [];
  if (where && Object.keys(where).length > 0) {
    const w = buildWhereClause(info, where, 1);
    sqlText += ` WHERE ${w.sqlText}`;
    values = w.values;
  }
  if (options?.orderBy) {
    const col = info.columnOf(options.orderBy.col);
    const dir = options.orderBy.direction === "desc" ? "DESC" : "ASC";
    sqlText += ` ORDER BY ${quoteIdent(col)} ${dir}`;
  }
  if (options?.limit !== undefined) {
    sqlText += ` LIMIT ${options.limit}`;
  }
  return (await db.unsafe(sqlText, values)) as readonly TRow[];
}

export async function fetchOne<TRow = Record<string, unknown>>(
  db: BunDbRunner,
  table: TableLike,
  where: WhereObject,
): Promise<TRow | undefined> {
  const rows = await selectMany<TRow>(db, table, where, { limit: 1 });
  return rows[0];
}

export async function insertOne<TRow = Record<string, unknown>>(
  db: BunDbRunner,
  table: TableLike,
  values: Record<string, unknown>,
): Promise<TRow | undefined> {
  const info = extractTableInfo(table);
  const entries = Object.entries(values).map(([k, v]) => {
    const col = info.columnOf(k);
    const pgType = info.pgTypeOf(col);
    const p = prepareValue(v, pgType);
    return { col, value: p.bound, cast: p.sql };
  });
  if (entries.length === 0) throw new Error("insertOne: empty values object");
  const cols = entries.map((e) => quoteIdent(e.col)).join(", ");
  const placeholders = entries.map((e, i) => `$${i + 1}${e.cast}`).join(", ");
  const params = entries.map((e) => e.value);
  const sqlText = `INSERT INTO ${quoteIdent(info.name)} (${cols}) VALUES (${placeholders}) RETURNING *`;
  const rows = (await db.unsafe(sqlText, params)) as readonly TRow[];
  return rows[0];
}

export async function updateMany<TRow = Record<string, unknown>>(
  db: BunDbRunner,
  table: TableLike,
  set: Record<string, unknown>,
  where: WhereObject,
): Promise<readonly TRow[]> {
  const info = extractTableInfo(table);
  const setEntries = Object.entries(set).map(([k, v]) => {
    const col = info.columnOf(k);
    const pgType = info.pgTypeOf(col);
    const p = prepareValue(v, pgType);
    return { col, value: p.bound, cast: p.sql };
  });
  if (setEntries.length === 0) throw new Error("updateMany: empty set object");
  const values: unknown[] = [];
  let idx = 1;
  const setParts: string[] = [];
  for (const e of setEntries) {
    setParts.push(`${quoteIdent(e.col)} = $${idx++}${e.cast}`);
    values.push(e.value);
  }
  const w = buildWhereClause(info, where, idx);
  let sqlText = `UPDATE ${quoteIdent(info.name)} SET ${setParts.join(", ")}`;
  if (w.sqlText) {
    sqlText += ` WHERE ${w.sqlText}`;
    for (const v of w.values) values.push(v);
  }
  sqlText += " RETURNING *";
  return (await db.unsafe(sqlText, values)) as readonly TRow[];
}

export async function deleteMany(
  db: BunDbRunner,
  table: TableLike,
  where: WhereObject,
): Promise<void> {
  const info = extractTableInfo(table);
  const w = buildWhereClause(info, where, 1);
  let sqlText = `DELETE FROM ${quoteIdent(info.name)}`;
  if (w.sqlText) sqlText += ` WHERE ${w.sqlText}`;
  await db.unsafe(sqlText, w.values);
}

export async function transaction<T>(
  db: BunDbRunner,
  fn: (tx: BunDbRunner) => Promise<T>,
): Promise<T> {
  return (await db.begin(async (tx) => fn(tx as BunDbRunner))) as T;
}
