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
import { camelCase as envCamelCase } from "../env";

// Idempotent snake_case → camelCase. `env.camelCase` always lowercases first
// (designed for SHOUT_CASE input) — for already-camelCase keys (mock rows
// in tests, projection-aliased columns) it would silently produce "tenantid"
// instead of leaving "tenantId" alone. Guard with an underscore check so
// the conversion only fires when the key is actually snake-shaped.
function snakeToCamel(key: string): string {
  if (!key.includes("_")) return key;
  return envCamelCase(key);
}
import type { BunDbRunner } from "./connection";

// Drizzle-pgTable-Inspection via raw Symbol-access (kein drizzle-orm import).
// drizzle stores the table name unter `Symbol.for("kumiko:schema:Name")` und die
// column-map unter `Symbol.for("kumiko:schema:Columns")`.
const KUMIKO_NAME_SYMBOL = Symbol.for("kumiko:schema:Name");
const KUMIKO_COLUMNS_SYMBOL = Symbol.for("kumiko:schema:Columns");

function getTableName(table: unknown): string | null {
  if (typeof table !== "object" || table === null) return null;
  const name = (table as Record<symbol, unknown>)[KUMIKO_NAME_SYMBOL];
  return typeof name === "string" ? name : null;
}

function extractDrizzleColumns(table: unknown): Map<string, { name: string; sqlType?: string }> {
  const out = new Map<string, { name: string; sqlType?: string }>();
  if (typeof table !== "object" || table === null) return out;
  const cols = (table as Record<symbol, unknown>)[KUMIKO_COLUMNS_SYMBOL];
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
  // Direct: Bun.SQL / postgres-js Sql / postgres-js TransactionSql. All three
  // expose `.unsafe`; only Sql/Bun.SQL have `.begin` — TransactionSql uses
  // `.savepoint` for nested-tx. We only require `.unsafe` here; callers that
  // need `.begin` (e.g. `transaction()`) verify it themselves.
  if (typeof dbAny["unsafe"] === "function") {
    return dbAny as unknown as RawClient;
  }
  // TenantDb-shape: framework wrapper exposing the underlying runner as `.raw`.
  // Callers that pass `ctx.db` instead of `ctx.db.raw` land here — unwrap once.
  const raw = dbAny["raw"];
  if (raw && typeof (raw as Record<string, unknown>)["unsafe"] === "function") {
    return raw as unknown as RawClient;
  }
  // Drizzle DbConnection (legacy compat): $client = postgres-js Sql.
  const $client = dbAny["$client"];
  if ($client && typeof ($client as Record<string, unknown>)["unsafe"] === "function") {
    return $client as unknown as RawClient;
  }
  // Drizzle pg-transaction (legacy compat): session.client = postgres-js Sql.
  const session = dbAny["session"] as Record<string, unknown> | undefined;
  const sessionClient = session?.["client"];
  if (sessionClient && typeof (sessionClient as Record<string, unknown>)["unsafe"] === "function") {
    return sessionClient as unknown as RawClient;
  }
  throw new Error(
    "bun-db: db argument has no .unsafe() — pass Bun.SQL, postgres-js Sql, TenantDb, or a transaction handle.",
  );
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
export type OrderByClause = {
  readonly col: string;
  readonly direction?: "asc" | "desc";
};

export type SelectOptions = {
  readonly limit?: number;
  // Single column or array for multi-column tie-breaks (e.g.
  // [{col: "createdAt"}, {col: "id"}] for chronological-with-stable-id).
  readonly orderBy?: OrderByClause | readonly OrderByClause[];
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
  // Inverse of columnOf — snake_case DB column → JS field-name (camelCase).
  // Used at the result boundary to rename row keys back to the API shape
  // that callers consume (`row.aggregateId` instead of `row.aggregate_id`).
  readonly fieldOf: (column: string) => string;
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
    const fieldByCol = new Map<string, string>();
    const typeByCol = new Map<string, string>();
    for (const c of meta.columns) {
      typeByCol.set(c.name, c.pgType);
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
      fieldOf: (col) => fieldByCol.get(col) ?? snakeToCamel(col),
    };
  }
  // drizzle pgTable: tableName via Symbol.for("kumiko:schema:Name"), columns via
  // enumerable properties (jeder col-object hat .name + .getSQLType()).
  // Wir lesen Beide via raw Symbol/Property-access — kein drizzle-orm import.
  const name = getTableName(table);
  if (!name) {
    throw new Error(
      "bun-db.extractTableInfo: table-Argument ist weder EntityTableMeta noch drizzle pgTable",
    );
  }
  const cols = extractDrizzleColumns(table);
  const colByField = new Map<string, string>();
  const fieldByCol = new Map<string, string>();
  const typeByCol = new Map<string, string>();
  for (const [field, { name: colName, sqlType }] of cols) {
    colByField.set(field, colName);
    fieldByCol.set(colName, field);
    if (sqlType) typeByCol.set(colName, sqlType);
  }
  return {
    name,
    columnOf: (field) => colByField.get(field) ?? toSnakeCase(field),
    pgTypeOf: (col) => typeByCol.get(col),
    fieldOf: (col) => fieldByCol.get(col) ?? snakeToCamel(col),
  };
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

// --- Value coercion at the driver boundary ------------------------------
//
// postgres-js returns timestamptz as JS Date (or ISO string depending on
// driver config). Framework contract says timestamptz surfaces as
// Temporal.Instant — without coercion every read hands callers a Date and
// downstream code that does .epochMilliseconds / .add(...) crashes.
//
// Symmetric on write: Temporal.Instant doesn't bind directly into postgres-js
// params — convert to ISO string when the column pgType is timestamptz.

function isTemporalInstant(v: unknown): boolean {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { epochNanoseconds?: unknown }).epochNanoseconds === "bigint"
  );
}

function instantFromDriver(value: unknown): Temporal.Instant | null {
  if (value === null || value === undefined) return null;
  if (isTemporalInstant(value)) return value as Temporal.Instant;
  if (value instanceof Date) return Temporal.Instant.fromEpochMilliseconds(value.getTime());
  if (typeof value === "string") {
    try {
      return Temporal.Instant.from(value);
    } catch {
      return null;
    }
  }
  if (typeof value === "number") return Temporal.Instant.fromEpochMilliseconds(value);
  return null;
}

// Walk the driver-row, applying three boundary-conversions per known column:
//   - rename key snake_case → camelCase JS field-name (drizzle did this
//     invisibly via its column-mapper; native dialect rebuild lost it)
//   - parse jsonb string → object (postgres-js returns jsonb as text by
//     default, not parsed JSON)
//   - coerce timestamptz Date/string → Temporal.Instant
//
// Unknown columns (computed/aliased) pass through unchanged.
function coerceRow<T extends Record<string, unknown>>(row: T, info: TableInfo): T {
  const out: Record<string, unknown> = {};
  let changed = false;
  for (const key of Object.keys(row)) {
    const pgType = info.pgTypeOf(key);
    const value = row[key];
    let coerced: unknown = value;
    if (pgType === "timestamptz" || pgType === "timestamptz(3)") {
      const t = instantFromDriver(value);
      if (t !== null) coerced = t;
    } else if (pgType === "jsonb" && typeof value === "string") {
      try {
        coerced = JSON.parse(value);
      } catch {
        // leave as string on parse error — caller decides
      }
    } else if ((pgType === "bigint" || pgType === "bigserial") && typeof value === "string") {
      // postgres-js returns BIGINT as string to avoid JS-Number precision
      // loss past 2^53. Framework contract: bigint columns surface as
      // JS `bigint`. Drizzle's bigint customType did this conversion
      // invisibly; the native dialect rebuild needs it explicit.
      try {
        coerced = BigInt(value);
      } catch {
        // leave as string on parse error
      }
    }
    const fieldName = info.fieldOf(key);
    if (fieldName !== key) changed = true;
    if (coerced !== value) changed = true;
    out[fieldName] = coerced;
  }
  return (changed ? out : row) as T;
}

function coerceRows<T extends Record<string, unknown>>(
  rows: readonly T[],
  info: TableInfo,
): readonly T[] {
  return rows.map((r) => coerceRow(r, info));
}

// Helper für jsonb-Werte: Bun.sql kann arrays/objects nicht direkt als
// jsonb binden — wir JSON.stringify + ::jsonb cast.
// Plus Temporal.Instant → ISO string coercion for timestamptz columns.
function prepareValue(value: unknown, pgType: string | undefined): { sql: string; bound: unknown } {
  if (pgType === "jsonb" && value !== null && typeof value === "object" && !isTemporalInstant(value)) {
    return { sql: "::jsonb", bound: JSON.stringify(value) };
  }
  if ((pgType === "timestamptz" || pgType === "timestamptz(3)") && isTemporalInstant(value)) {
    return { sql: "", bound: (value as Temporal.Instant).toString() };
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

// biome-ignore lint/suspicious/noExplicitAny: opt-in default loosens row type for unannotated test fixtures
export async function selectMany<TRow = any>(
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
    const clauses = Array.isArray(options.orderBy) ? options.orderBy : [options.orderBy];
    const parts = clauses.map((c) => {
      const col = info.columnOf(c.col);
      const dir = c.direction === "desc" ? "DESC" : "ASC";
      return `${quoteIdent(col)} ${dir}`;
    });
    if (parts.length > 0) sqlText += ` ORDER BY ${parts.join(", ")}`;
  }
  if (options?.limit !== undefined) {
    sqlText += ` LIMIT ${options.limit}`;
  }
  const raw = (await asRawClient(db).unsafe(sqlText, values)) as readonly Record<string, unknown>[];
  return coerceRows(raw, info) as readonly TRow[];
}

// biome-ignore lint/suspicious/noExplicitAny: see selectMany default
export async function fetchOne<TRow = any>(
  db: AnyDb,
  table: TableLike,
  where: WhereObject,
): Promise<TRow | undefined> {
  const rows = await selectMany<TRow>(db, table, where, { limit: 1 });
  return rows[0];
}

// Bulk INSERT — same shape as insertOne but takes an array of rows and
// produces one multi-VALUES statement. Mirrors drizzle's
// `db.insert(t).values(rows[])`. Empty input is a no-op.
// biome-ignore lint/suspicious/noExplicitAny: see selectMany default
export async function insertMany<TRow = any>(
  db: AnyDb,
  table: TableLike,
  rows: ReadonlyArray<Record<string, unknown>>,
): Promise<readonly TRow[]> {
  if (rows.length === 0) return [];
  const info = extractTableInfo(table);
  // Use the column-set from the first row; assume all rows share keys.
  const firstRow = rows[0];
  if (firstRow === undefined) return [];
  const fields = Object.keys(firstRow);
  if (fields.length === 0) throw new Error("insertMany: empty row object");
  const cols = fields.map((k) => quoteIdent(info.columnOf(k))).join(", ");
  const params: unknown[] = [];
  const valuesClauses: string[] = [];
  for (const row of rows) {
    const placeholders: string[] = [];
    for (const f of fields) {
      const col = info.columnOf(f);
      const pgType = info.pgTypeOf(col);
      const p = prepareValue(row[f], pgType);
      params.push(p.bound);
      placeholders.push(`$${params.length}${p.sql}`);
    }
    valuesClauses.push(`(${placeholders.join(", ")})`);
  }
  const sqlText = `INSERT INTO ${quoteIdent(info.name)} (${cols}) VALUES ${valuesClauses.join(", ")} RETURNING *`;
  const raw = (await asRawClient(db).unsafe(sqlText, params)) as readonly Record<string, unknown>[];
  return coerceRows(raw, info) as readonly TRow[];
}

// biome-ignore lint/suspicious/noExplicitAny: see selectMany default
export async function insertOne<TRow = any>(
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
  const rows = (await asRawClient(db).unsafe(sqlText, params)) as readonly Record<string, unknown>[];
  const first = rows[0];
  if (!first) return undefined;
  return coerceRow(first, info) as TRow;
}

// biome-ignore lint/suspicious/noExplicitAny: see selectMany default
export async function updateMany<TRow = any>(
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
  const raw = (await asRawClient(db).unsafe(sqlText, values)) as readonly Record<string, unknown>[];
  return coerceRows(raw, info) as readonly TRow[];
}

export async function deleteMany(db: AnyDb, table: TableLike, where: WhereObject): Promise<void> {
  const info = extractTableInfo(table);
  const w = buildWhereClause(info, where, 1);
  let sqlText = `DELETE FROM ${quoteIdent(info.name)}`;
  if (w.sqlText) sqlText += ` WHERE ${w.sqlText}`;
  await asRawClient(db).unsafe(sqlText, w.values);
}

export async function transaction<T>(db: AnyDb, fn: (tx: BunDbRunner) => Promise<T>): Promise<T> {
  return (await asRawClient(db).begin(async (tx) => fn(tx as BunDbRunner))) as T;
}
