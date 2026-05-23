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

import type { EntityTableMeta } from "../db/entity-table-meta";
import { toSnakeCase } from "../db/table-builder";
import type { BunDbRunner } from "./connection";

// Drizzle-pgTable-Inspection via raw Symbol-access (kein drizzle-orm import).
// drizzle stores the table name unter `Symbol.for("drizzle:Name")` und die
// column-map unter `Symbol.for("drizzle:Columns")`.
const DRIZZLE_NAME_SYMBOL = Symbol.for("drizzle:Name");
const DRIZZLE_COLUMNS_SYMBOL = Symbol.for("drizzle:Columns");

function getDrizzleTableName(table: unknown): string | null {
  if (typeof table !== "object" || table === null) return null;
  const name = (table as Record<symbol, unknown>)[DRIZZLE_NAME_SYMBOL];
  return typeof name === "string" ? name : null;
}

function extractDrizzleColumns(table: unknown): Map<string, { name: string; sqlType?: string }> {
  const out = new Map<string, { name: string; sqlType?: string }>();
  if (typeof table !== "object" || table === null) return out;
  const cols = (table as Record<symbol, unknown>)[DRIZZLE_COLUMNS_SYMBOL];
  if (typeof cols !== "object" || cols === null) return out;
  for (const [key, val] of Object.entries(cols as Record<string, unknown>)) {
    if (typeof val !== "object" || val === null) continue;
    const colObj = val as { name?: unknown; getSQLType?: () => string };
    const colName = colObj.name;
    if (typeof colName !== "string") continue;
    // Drizzle's getSQLType uses `this` — call as method on colObj.
    const sqlType = typeof colObj.getSQLType === "function" ? colObj.getSQLType() : undefined;
    out.set(key, { name: colName, ...(sqlType !== undefined && { sqlType }) });
  }
  return out;
}

// `db` Input akzeptiert drei Shapes:
//   1. Bun.SQL connection (BunDbRunner) — neue Welt, native .unsafe + .begin
//   2. drizzle DbConnection (postgres-js-Wrapper) — legacy compat,
//      raw postgres-js client liegt unter `db.$client.unsafe / .begin`
//   3. drizzle tx-handle — client liegt unter `tx.session.client`
// Shim extrahiert in allen Fällen ein `{unsafe, begin}`-Surface.
type RawClient = {
  unsafe: <TRow = unknown>(sql: string, params?: readonly unknown[]) => Promise<readonly TRow[]>;
  begin: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
};

export function asRawClient(db: unknown): RawClient {
  const dbAny = db as Record<string, unknown>;
  // Bun.SQL: .unsafe() + .begin() direkt auf dem Instance.
  if (typeof dbAny["unsafe"] === "function" && typeof dbAny["begin"] === "function") {
    return dbAny as unknown as RawClient;
  }
  // Drizzle DbConnection: $client = postgres-js Sql.
  const $client = dbAny["$client"];
  if (
    $client &&
    typeof ($client as Record<string, unknown>)["unsafe"] === "function"
  ) {
    return $client as unknown as RawClient;
  }
  // Drizzle pg-transaction: session.client = postgres-js Sql.
  const session = dbAny["session"] as Record<string, unknown> | undefined;
  const sessionClient = session?.["client"];
  if (
    sessionClient &&
    typeof (sessionClient as Record<string, unknown>)["unsafe"] === "function"
  ) {
    return sessionClient as unknown as RawClient;
  }
  throw new Error("bun-db: db argument has no .unsafe() — pass Bun.SQL, drizzle DbConnection, or drizzle tx.");
}

export type AnyDb = BunDbRunner | unknown;

// WhereValue: primitive für eq, array für IN, null für IS NULL, oder
// operator-object für range/comparisons.
export type WhereOperator = {
  readonly gt?: unknown;
  readonly gte?: unknown;
  readonly lt?: unknown;
  readonly lte?: unknown;
  readonly ne?: unknown;
  readonly in?: readonly unknown[];
  readonly like?: string;
};
export type WhereValue = unknown | WhereOperator;
export type WhereObject = Record<string, WhereValue>;

function isWhereOperator(v: unknown): v is WhereOperator {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  // Don't false-positive on Date / Temporal / other domain-objects.
  // WhereOperator is plain object literal with at most these keys.
  const keys = Object.keys(v);
  if (keys.length === 0) return false;
  const opKeys = ["gt", "gte", "lt", "lte", "ne", "in", "like"];
  return keys.every((k) => opKeys.includes(k));
}
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
  // drizzle pgTable: tableName via Symbol.for("drizzle:Name"), columns via
  // enumerable properties (jeder col-object hat .name + .getSQLType()).
  // Wir lesen Beide via raw Symbol/Property-access — kein drizzle-orm import.
  const name = getDrizzleTableName(table);
  if (!name) {
    throw new Error(
      "bun-db.extractTableInfo: table-Argument ist weder EntityTableMeta noch drizzle pgTable",
    );
  }
  const cols = extractDrizzleColumns(table);
  const colByField = new Map<string, string>();
  const typeByCol = new Map<string, string>();
  for (const [field, { name: colName, sqlType }] of cols) {
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
    const pgType = info.pgTypeOf(col);
    if (value === null) {
      conditions.push(`${quoteIdent(col)} IS NULL`);
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        conditions.push("FALSE");
      } else {
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
    } else if (isWhereOperator(value)) {
      const opMap: Record<string, string> = {
        gt: ">",
        gte: ">=",
        lt: "<",
        lte: "<=",
        ne: "<>",
        like: "LIKE",
      };
      for (const [opKey, opSym] of Object.entries(opMap)) {
        const opVal = (value as Record<string, unknown>)[opKey];
        if (opVal === undefined) continue;
        const p = prepareValue(opVal, pgType);
        conditions.push(`${quoteIdent(col)} ${opSym} $${idx++}${p.sql}`);
        values.push(p.bound);
      }
      const inVal = (value as Record<string, unknown>)["in"];
      if (Array.isArray(inVal)) {
        if (inVal.length === 0) {
          conditions.push("FALSE");
        } else {
          const placeholders = inVal.map(() => `$${idx++}`).join(", ");
          conditions.push(`${quoteIdent(col)} IN (${placeholders})`);
          for (const v of inVal) {
            const p = prepareValue(v, pgType);
            values.push(p.bound);
          }
        }
      }
    } else {
      const p = prepareValue(value, pgType);
      conditions.push(`${quoteIdent(col)} = $${idx++}${p.sql}`);
      values.push(p.bound);
    }
  }
  return { sqlText: conditions.join(" AND "), values };
}

export async function selectMany<TRow = Record<string, unknown>>(
  db: AnyDb,
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
  return (await asRawClient(db).unsafe(sqlText, values)) as readonly TRow[];
}

export async function fetchOne<TRow = Record<string, unknown>>(
  db: AnyDb,
  table: TableLike,
  where: WhereObject,
): Promise<TRow | undefined> {
  const rows = await selectMany<TRow>(db, table, where, { limit: 1 });
  return rows[0];
}

export async function insertOne<TRow = Record<string, unknown>>(
  db: AnyDb,
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
  const rows = (await asRawClient(db).unsafe(sqlText, params)) as readonly TRow[];
  return rows[0];
}

export async function updateMany<TRow = Record<string, unknown>>(
  db: AnyDb,
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
  return (await asRawClient(db).unsafe(sqlText, values)) as readonly TRow[];
}

export async function deleteMany(
  db: AnyDb,
  table: TableLike,
  where: WhereObject,
): Promise<void> {
  const info = extractTableInfo(table);
  const w = buildWhereClause(info, where, 1);
  let sqlText = `DELETE FROM ${quoteIdent(info.name)}`;
  if (w.sqlText) sqlText += ` WHERE ${w.sqlText}`;
  await asRawClient(db).unsafe(sqlText, w.values);
}

export async function transaction<T>(
  db: AnyDb,
  fn: (tx: BunDbRunner) => Promise<T>,
): Promise<T> {
  return (await asRawClient(db).begin(async (tx) => fn(tx as BunDbRunner))) as T;
}
