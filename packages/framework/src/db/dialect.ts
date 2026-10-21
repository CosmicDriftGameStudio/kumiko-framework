// Native dialect — replaces drizzle-orm/pg-core re-exports.
//
// Produces table objects that simultaneously expose:
//   1. EntityTableMeta shape (source/columns/indexes) for the query helpers'
//      extractTableInfo + the migrate-runner's renderTableDdl
//   2. drizzle-compatible Symbol metadata so callers that introspect
//      Symbol.for("kumiko:schema:Name") / Symbol.for("kumiko:schema:Columns") keep
//      working (no caller updates needed)
//   3. Top-level column-handle properties (table.id, table.tenantId, ...)
//      so legacy code that does `table[field].name` still resolves to the
//      snake_case SQL column name.
//
// The framework no longer imports drizzle-orm at runtime — schema-files
// use only this module.
//
// Static import of the shared Temporal module, not the ambient global: the
// global may be absent (Hermes/Safari) or torn down in tests, and instantToDriver
// crashed on timestamptz writes without it.

import type { WritableSchemaTable } from "@cosmicdrift/kumiko-types/executor-brand";
import {
  type ColumnHandle,
  KUMIKO_COLUMNS_SYMBOL,
  KUMIKO_META_SYMBOL,
  KUMIKO_NAME_SYMBOL,
  type SchemaTable,
} from "@cosmicdrift/kumiko-types/schema-table-types";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import type {
  ColumnMeta,
  CompositePrimaryKeyMeta,
  EntityTableMeta,
  IndexMeta,
  PgType,
} from "./entity-table-meta.ts";
import { brandWritable, schemaTableName } from "./table-introspection.ts";

export type { ColumnHandle, SchemaTable } from "@cosmicdrift/kumiko-types/schema-table-types";

// Public type aliases — historical compat for callers that used to import
// these from drizzle-orm/pg-core. SelectQuery is no longer a meaningful
// shape (no chain builder); TableColumns is the new SchemaTable union.
export type TableColumns<_T = unknown> = SchemaTable;
export type SelectQuery = unknown;

function isNumericPgType(t: PgType): t is `numeric(${number},${number})` {
  return t.startsWith("numeric(");
}

export function pgTypeToSqlType(pgType: PgType): string {
  // numeric(p,s) carries its precision/scale in the type string — already
  // valid SQL. The guard narrows it out so the switch below stays exhaustive
  // over the fixed members (a forgotten member still fails the type-check).
  if (isNumericPgType(pgType)) return pgType;
  switch (pgType) {
    case "uuid":
      return "uuid";
    case "text":
      return "text";
    case "boolean":
      return "boolean";
    case "integer":
      return "integer";
    case "double precision":
      return "double precision";
    case "bigint":
      return "bigint";
    case "serial":
      return "serial";
    case "bigserial":
      return "bigserial";
    case "jsonb":
      return "jsonb";
    case "timestamptz":
      return "timestamp with time zone";
    case "timestamptz(3)":
      return "timestamp(3) with time zone";
    case "date":
      return "date";
  }
}

function _toSnakeCase(name: string): string {
  return name.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`).replace(/^_/, "");
}

// ---- Column builder ----
//
// Returned by uuid()/text()/etc. Chainable: notNull/primaryKey/default/unique.
// Internal state captured in the builder; finalised when handed to table().
// `name` is set explicitly on the first call (uuid("user_id")) and may be
// overridden by `withCamel(jsField)` so the handle exposes both the SQL name
// AND the JS field-name for type inference.

type ColumnFinal = {
  readonly sqlName: string;
  readonly pgType: PgType;
  readonly notNull: boolean;
  readonly primaryKey: boolean;
  readonly unique: boolean;
  readonly identity: boolean;
  readonly defaultSql?: string;
  readonly bigintJsMode?: "number" | "bigint";
};

export type ColumnBuilder<TValue = unknown> = {
  readonly __column: true;
  readonly finalise: () => ColumnFinal;
  notNull(): ColumnBuilder<TValue>;
  primaryKey(): ColumnBuilder<TValue>;
  default(
    value: TValue | SqlExpression | readonly unknown[] | number | string | boolean | null,
  ): ColumnBuilder<TValue>;
  defaultRandom(): ColumnBuilder<TValue>;
  defaultNow(): ColumnBuilder<TValue>;
  generatedAlwaysAsIdentity(): ColumnBuilder<TValue>;
  unique(name?: string): ColumnBuilder<TValue>;
  $type<T>(): ColumnBuilder<T>;
  $onUpdate(fn: () => unknown): ColumnBuilder<TValue>;
};

// TValue is never inferred from the factory's declared return type, so a factory that forgets its
// type argument fails to compile instead of silently typing the column from its own annotation.
function buildColumn<TValue = never>(
  sqlName: string,
  pgType: PgType,
  opts?: { bigintJsMode?: "number" | "bigint" },
): ColumnBuilder<NoInfer<TValue>> {
  let notNull = false;
  let primaryKey = false;
  let unique = false;
  let identity = false;
  let defaultSql: string | undefined;

  function literalDefault(value: unknown): string | null {
    if (value === undefined) return null;
    if (value === null) return "NULL";
    if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
    if (typeof value === "number") return String(value);
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "bigint") return value.toString();
    if (isSqlExpression(value)) return value.text;
    if (typeof value === "function") return null; // function-defaults stay JS-side
    // Object/array → jsonb literal
    const serialised = JSON.stringify(value);
    if (serialised === undefined) return null;
    return `'${serialised.replace(/'/g, "''")}'::jsonb`;
  }

  const builder: ColumnBuilder<TValue> = {
    __column: true,
    finalise(): ColumnFinal {
      return {
        sqlName,
        pgType,
        notNull,
        primaryKey,
        unique,
        identity,
        ...(defaultSql !== undefined && { defaultSql }),
        ...(opts?.bigintJsMode !== undefined && { bigintJsMode: opts.bigintJsMode }),
      };
    },
    notNull() {
      notNull = true;
      return builder;
    },
    primaryKey() {
      primaryKey = true;
      notNull = true;
      return builder;
    },
    default(value: unknown) {
      const rendered = literalDefault(value);
      defaultSql = rendered === null ? undefined : rendered;
      return builder;
    },
    defaultRandom() {
      defaultSql = "gen_random_uuid()";
      return builder;
    },
    defaultNow() {
      defaultSql = "now()";
      return builder;
    },
    generatedAlwaysAsIdentity() {
      identity = true;
      defaultSql = undefined;
      return builder;
    },
    unique(_name?: string) {
      unique = true;
      return builder;
    },
    $type<T>() {
      return builder as unknown as ColumnBuilder<T>;
    },
    $onUpdate(_fn: () => unknown) {
      // Runtime $onUpdate is a no-op in the schema layer — the framework's
      // event-driven projection write path sets modified_at explicitly.
      return builder;
    },
  };
  return builder;
}

// ---- Column factories ----

export function uuid(name: string): ColumnBuilder<string> {
  return buildColumn<string>(name, "uuid");
}

export function text(name: string): ColumnBuilder<string> {
  return buildColumn<string>(name, "text");
}

export function boolean(name: string): ColumnBuilder<boolean> {
  return buildColumn<boolean>(name, "boolean");
}

export function integer(name: string): ColumnBuilder<number> {
  return buildColumn<number>(name, "integer");
}

export function doublePrecision(name: string): ColumnBuilder<number> {
  return buildColumn<number>(name, "double precision");
}

export function serial(name: string): ColumnBuilder<number> {
  return buildColumn<number>(name, "serial");
}

export function bigint(name: string, opts?: { mode?: "bigint" | "number" }): ColumnBuilder<bigint> {
  const jsMode = opts?.mode === "number" ? "number" : "bigint";
  return buildColumn<bigint>(name, "bigint", { bigintJsMode: jsMode });
}

export function bigserial(
  name: string,
  _opts?: { mode?: "bigint" | "number" },
): ColumnBuilder<bigint> {
  return buildColumn<bigint>(name, "bigserial");
}

export function jsonb(name: string): ColumnBuilder<Record<string, unknown>> {
  return buildColumn<Record<string, unknown>>(name, "jsonb");
}

// Legacy alias kept for compat — timestamptz with no precision.
export function timestamp(
  name: string,
  _opts?: { withTimezone?: boolean; mode?: "string" | "date" },
): ColumnBuilder<Temporal.Instant | string> {
  return buildColumn<Temporal.Instant | string>(name, "timestamptz");
}

// numeric → text (we don't currently use Decimal); kept for compat with
// legacy schema imports that won't actually instantiate at runtime.
export function numeric(
  name: string,
  _opts?: { precision?: number; scale?: number },
): ColumnBuilder<string> {
  return buildColumn<string>(name, "text");
}

export function instant(
  name: string,
  opts?: { precision?: 0 | 1 | 2 | 3 | 4 | 5 | 6 },
): ColumnBuilder<Temporal.Instant> {
  const pgType: PgType = opts?.precision === 3 ? "timestamptz(3)" : "timestamptz";
  return buildColumn<Temporal.Instant>(name, pgType);
}

// PG `date` — no time-of-day, no timezone. Calendar-day fields (invoice
// date, lease term) round-trip as Temporal.PlainDate, never through an
// Instant — that detour is exactly what made `type:"date"` TZ-dependent on
// both read and write.
export function plainDate(name: string): ColumnBuilder<Temporal.PlainDate> {
  return buildColumn<Temporal.PlainDate>(name, "date");
}

// Real numeric(precision, scale) column — exact decimal storage (interest
// rates, percentages, ratios). pg returns numeric as a STRING; coerceRow
// parses it back to JS number on read (safe ≤ 2^53). Precision/scale live in
// the pgType string, so DDL render + coercion need no extra metadata.
export const decimalColumn = (
  name: string,
  precision: number,
  scale: number,
): ColumnBuilder<number> => buildColumn<number>(name, `numeric(${precision},${scale})`);

// moneyAmount kept as a customType-style API but produces a bigint column.
// bigintJsMode "bigint" — entity-table-meta renders money as bigint, and the
// table-builder↔meta lockstep guard fails on a number-mode column. (Precision
// past 2^53 is the underlying motivation, not the immediate breakage.)
export const moneyAmount = (name: string): ColumnBuilder<bigint> =>
  buildColumn<bigint>(name, "bigint", { bigintJsMode: "bigint" });

// ---- Index + primaryKey helpers ----

export type IndexBuilder = {
  readonly __index: true;
  on(...cols: ColumnHandle[]): IndexBuilderWithCols;
};

export type IndexBuilderWithCols = {
  readonly __index: true;
  readonly name: string;
  readonly unique: boolean;
  readonly columns: readonly string[];
  where(expr: SqlExpression): IndexBuilderWithCols;
  readonly whereSql?: string;
};

function makeIndex(name: string, unique: boolean): IndexBuilder {
  return {
    __index: true,
    on(...cols: ColumnHandle[]): IndexBuilderWithCols {
      const colNames = cols.map((c) => c.name);
      let whereSql: string | undefined;
      const finalised: IndexBuilderWithCols = {
        __index: true,
        name,
        unique,
        columns: colNames,
        get whereSql() {
          return whereSql;
        },
        where(expr: SqlExpression) {
          whereSql = expr.text;
          return finalised;
        },
      };
      return finalised;
    },
  };
}

// @wrapper-known semantic-alias
export function index(name: string): IndexBuilder {
  return makeIndex(name, false);
}

// @wrapper-known semantic-alias
export function uniqueIndex(name: string): IndexBuilder {
  return makeIndex(name, true);
}

export type PrimaryKeyDescriptor = {
  readonly __pk: true;
  readonly columns: readonly string[];
  readonly name?: string;
};

export function primaryKey(opts: {
  columns: readonly ColumnHandle[];
  name?: string;
}): PrimaryKeyDescriptor {
  return {
    __pk: true,
    columns: opts.columns.map((c) => c.name),
    ...(opts.name !== undefined && { name: opts.name }),
  };
}

// ---- sql template ----
//
// A constrained sql template tag. Returns a SqlExpression carrying the
// composed text + params. Used in DEFAULT expressions in schema files
// (sql`now()`, sql`gen_random_uuid()`, sql`0`).
//
// Limits: no nested SqlExpression composition (drizzle's recursive
// `sql\`${other}\``) — schema-files use single-level expressions only.

// Unforgeable via JSON — a client-supplied jsonb value can fake `kind:
// "sql-expr"` but can never carry a Symbol, so isSqlExpression() (db/query.ts)
// can't be tricked into treating request data as a raw SQL literal. The same
// brand gate is enforced here in the schema DSL (sql`...` interpolation +
// literalDefault) and in entity-table-meta's sqlExpressionText — a duck-typed
// `{ kind: "sql-expr" }` from a client-controlled schema definition is never
// spliced into SQL text anywhere.
export const SQL_EXPR_BRAND: unique symbol = Symbol("sql-expr");

export type SqlExpression = {
  readonly kind: "sql-expr";
  readonly text: string;
  readonly params: readonly unknown[];
  readonly [SQL_EXPR_BRAND]: true;
};

export function isSqlExpression(value: unknown): value is SqlExpression {
  return (
    typeof value === "object" &&
    value !== null &&
    SQL_EXPR_BRAND in value &&
    "text" in value &&
    typeof value.text === "string"
  );
}

export function sql(strings: TemplateStringsArray, ...values: readonly unknown[]): SqlExpression {
  const parts: string[] = [];
  const params: unknown[] = [];
  for (let i = 0; i < strings.length; i++) {
    parts.push(strings[i] ?? "");
    if (i < values.length) {
      const v = values[i];
      if (isSqlExpression(v)) {
        parts.push(v.text);
      } else {
        parts.push(String(v));
      }
    }
  }
  return { kind: "sql-expr", text: parts.join(""), params, [SQL_EXPR_BRAND]: true };
}

sql.raw = (text: string): SqlExpression => ({
  kind: "sql-expr",
  text,
  params: [],
  [SQL_EXPR_BRAND]: true,
});

// ---- table() — the schema-table factory ----
//
// Produces a SchemaTable with:
//   - EntityTableMeta shape (source/tableName/columns/indexes)
//   - Drizzle Symbol metadata for compat with the introspection in db/query.ts
//   - Top-level column-handle properties (table.fieldName → ColumnHandle)
//
// Second arg is an object whose keys are JS field-names; values are
// ColumnBuilder. Third arg is the constraints/index callback receiving
// a record of ColumnHandle (so existing `(t) => ({ idx: index(...).on(t.col) })`
// patterns work).

export type ColumnMap = Record<string, ColumnBuilder<unknown>>;

type IndexOrPk = IndexBuilderWithCols | PrimaryKeyDescriptor;

function isIndexOrPkList(
  opts: Record<string, IndexOrPk> | ReadonlyArray<IndexOrPk>,
): opts is ReadonlyArray<IndexOrPk> {
  return Array.isArray(opts);
}

function isPrimaryKeyDescriptor(value: IndexOrPk): value is PrimaryKeyDescriptor {
  return "__pk" in value && value.__pk === true;
}

function isIndexBuilderWithCols(value: IndexOrPk): value is IndexBuilderWithCols {
  return "__index" in value && value.__index === true;
}

export function table<TCols extends ColumnMap>(
  tableName: string,
  cols: TCols,
  optsFn?: (
    t: { [K in keyof TCols]: ColumnHandle },
  ) => Record<string, IndexOrPk> | ReadonlyArray<IndexOrPk>,
): WritableSchemaTable {
  // Finalise columns + build the column-handle map.
  const handles: Record<string, ColumnHandle> = {};
  const columnMetas: ColumnMeta[] = [];
  const indexes: IndexMeta[] = [];
  for (const [field, builder] of Object.entries(cols)) {
    const final = builder.finalise();
    const handle: ColumnHandle = {
      name: final.sqlName,
      pgType: final.pgType,
      getSQLType: () => pgTypeToSqlType(final.pgType), // @wrapper-known semantic-alias
    };
    handles[field] = handle;
    const meta: ColumnMeta = {
      name: final.sqlName,
      pgType: final.pgType,
      notNull: final.notNull,
      ...(final.primaryKey && { primaryKey: true }),
      ...(final.identity && { identity: true }),
      ...(final.defaultSql !== undefined && { defaultSql: final.defaultSql }),
      ...(final.bigintJsMode !== undefined && { bigintJsMode: final.bigintJsMode }),
    };
    columnMetas.push(meta);

    // Per-column .unique() → single-column unique index
    if (final.unique) {
      indexes.push({
        name: `${tableName}_${final.sqlName}_unique`,
        columns: [final.sqlName],
        unique: true,
      });
    }
  }

  // Evaluate index/pk callback with the column handles.
  let compositePrimaryKey: CompositePrimaryKeyMeta | undefined;
  if (optsFn) {
    const tHandle = handles as { [K in keyof TCols]: ColumnHandle };
    const opts = optsFn(tHandle);
    const entries: Array<[string, IndexOrPk | undefined]> = isIndexOrPkList(opts)
      ? opts.map((v, i) => [String(i), v])
      : Object.entries(opts);
    for (const [key, value] of entries) {
      if (!value) continue;
      if (isPrimaryKeyDescriptor(value)) {
        compositePrimaryKey = {
          name: value.name ?? `${tableName}_pk`,
          columns: value.columns,
        };
      } else if (isIndexBuilderWithCols(value)) {
        indexes.push({
          name: value.name,
          columns: value.columns,
          ...(value.unique && { unique: true }),
          ...(value.whereSql !== undefined && { whereSql: value.whereSql }),
        });
      } else {
        // Inline unique-column declaration via .unique() — not implemented yet.
        // Schema files don't currently use that path; pinned by the table-types
        // test fixture if it's ever added.
        const _k = key;
      }
    }
  }

  // Build the SchemaTable. Object.assign to layer the column handles + symbols
  // onto the EntityTableMeta-shaped object so introspection works.
  const base: EntityTableMeta = {
    tableName,
    columns: columnMetas,
    indexes,
    ...(compositePrimaryKey !== undefined && { compositePrimaryKey }),
    source: "unmanaged",
  };
  const out: SchemaTable = Object.assign({}, base, handles, {
    [KUMIKO_NAME_SYMBOL]: tableName,
    [KUMIKO_COLUMNS_SYMBOL]: handles,
    [KUMIKO_META_SYMBOL]: base,
  });
  return brandWritable(out);
}

/** Reads the `kumiko:schema:Name` symbol from a table object.
 *  Throws with `context` in the message so callers don't have to duplicate the guard. */
export function extractTableName(table: unknown, context = "extractTableName"): string {
  if (typeof table !== "object" || table === null) {
    throw new Error(`${context}: table is not an object`);
  }
  const name = schemaTableName(table);
  if (name === undefined) {
    throw new Error(`${context}: table missing kumiko:schema:Name symbol`);
  }
  return name;
}

// Helper used by `instantToDriver` callers in legacy code — kept identical
// to the previous behaviour. The native dialect handles parse/serialize
// implicitly via the Bun driver; this function is a defensive coerce at
// the API boundary.
export function instantToDriver(value: Temporal.Instant | string): string {
  if (typeof value === "string") {
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
    const iso = dateOnly ? `${value}T00:00:00Z` : value;
    return Temporal.Instant.from(iso).toString();
  }
  return value.toString();
}
