// Typed query helpers over the Bun.SQL driver: EntityTableMeta in, rows out.
//
// API:
//   selectMany<T>(db, table, where?, opts?) → readonly T[]
//   fetchOne<T>(db, table, where) → T | undefined
//   insertOne<T>(db, table, values) → T | undefined
//   updateMany<T>(db, table, set, where) → readonly T[]
//   deleteMany(db, table, where) → number of deleted rows
//   countWhere(db, table, where?) → number
//   upsertByPk / upsertOnConflict / incrementCounter
//   deleteManyBatched(db, table, where, { limit }) → { deleted, batches }
//   transaction<T>(db, fn) → T
//
// `table` is an EntityTableMeta; the legacy table objects carrying it under a Symbol are accepted too.

import type { AggregateRow, AggregateSpec } from "@cosmicdrift/kumiko-types/aggregate-types";
import type { DbRunner, DbTx } from "@cosmicdrift/kumiko-types/db-connection";
import type {
  ExecutorManagedRunner,
  ExecutorManagedWriteCapability,
  WritableTable,
} from "@cosmicdrift/kumiko-types/executor-brand";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import type { SelectOptions, WhereObject } from "@cosmicdrift/kumiko-types/where-clause-types";
import { quoteIdent } from "../crypto/ciphertext-pattern.ts";
import { InternalError } from "../errors/index.ts";
import {
  aggregateDimensionSql,
  aggregateGroupOrderLimitSql,
  aggregateKeyOf,
  aggregateMeasureSql,
  assertValidAggregateLimits,
} from "./aggregate-sql.ts";
import {
  type ClosedConnectionContext,
  isClosedConnectionError,
  isPooledClient,
  logClosedConnection,
  poolMaxOf,
} from "./closed-connection.ts";
import { buildDistinctOnClause } from "./distinct-on.ts";
import { coerceDriverRow } from "./driver-row-coercion.ts";
import { type PreparedValue, prepareValue } from "./driver-value-preparation.ts";
import type { EntityTableMeta } from "./entity-table-meta.ts";
import { executorManagedWriteDenied } from "./executor-managed-tables.ts";
import { extractPgError } from "./pg-error.ts";
import { extractTableInfo, type TableInfo } from "./table-info.ts";
import { asEntityTableMeta, requireEntityTableMeta } from "./table-introspection.ts";
import { openSerializedSavepoint } from "./transaction-serialization.ts";
import { buildWhereClause } from "./where-clause.ts";

// table() (dialect) stores the canonical, shadow-proof EntityTableMeta under
// `Symbol.for("kumiko:schema:Meta")`. The column handles on the table object are
// enumerable props, so an entity field named `source`/`columns`/`tableName`/…
// would overwrite the matching meta key — reading the meta from the symbol is
// the only collision-safe path.

export { asEntityTableMeta, requireEntityTableMeta };

// `db` input accepts three shapes:
//   1. Bun.SQL client or transaction handle — native .unsafe (+ .begin on the pool client)
//   2. wrapper exposing the Bun.SQL client under `db.$client`
//   3. wrapper exposing it under `tx.session.client`
// asRawClient extracts a `{unsafe, begin}` surface in every case.
// begin is optional: a Bun.SQL transaction handle cannot start another one (see hasBegin);
// savepoint/release exist only on tx handles.
// A pinned connection from reserve(): every statement runs on the same session,
// which session-level state (advisory locks, BEGIN/COMMIT) depends on.
export type ReservedClient = {
  unsafe: RawClient["unsafe"];
  release: () => unknown;
};

export type RawClient = {
  unsafe: <TRow = unknown>(sql: string, params?: readonly unknown[]) => Promise<readonly TRow[]>;
  begin?: <T>(fn: (tx: DbTx) => Promise<T>) => Promise<T>;
  savepoint?: <T>(fn: (sp: unknown) => Promise<T>) => Promise<T>;
  release?: unknown;
  reserve?: () => Promise<ReservedClient>;
};

export type RawClientWithBegin = RawClient & {
  begin: NonNullable<RawClient["begin"]>;
};

export function hasBegin(client: RawClient): client is RawClientWithBegin {
  // Tx/savepoint handles can keep a begin() that throws; only savepoint() tells them apart from a pool.
  return typeof client.begin === "function" && !hasSavepoint(client);
}

type RawClientWithSavepoint = RawClient & {
  savepoint: NonNullable<RawClient["savepoint"]>;
};

function hasSavepoint(client: RawClient): client is RawClientWithSavepoint {
  return typeof client.savepoint === "function";
}

function isRawClient(value: unknown): value is RawClient {
  return typeof propertyOf(value, "unsafe") === "function";
}

export function asRawClient(db: unknown): RawClient {
  // Direct: Bun.SQL pool / transaction handle. Both
  // expose `.unsafe`; only the pool starts a transaction — a transaction handle uses
  // `.savepoint` for nesting. We only require `.unsafe` here; callers that
  // need `.begin` (e.g. `transaction()`) verify it themselves.
  if (isRawClient(db)) return db;
  // TenantDb (ctx.db) has no unfiltered escape via asRawClient anymore — fail
  // closed instead of silently unwrapping a tenant-scoped handle.
  if (isTenantDbShape(db)) {
    throw new Error(
      "asRawClient: received a tenant-scoped TenantDb (ctx.db). Raw SQL helpers do not apply the " +
        "tenant filter — use a ctx.db.<method>, or ctx.db.unsafeRaw() with escapeHatch: " +
        "{ reason } on the handler/hook (r.systemScope() features: ctx.systemDb.unsafeRaw(reason)).",
    );
  }
  // Wrapper handle: $client = Bun.SQL pool.
  const $client = propertyOf(db, "$client");
  if (isRawClient($client)) return $client;
  // Wrapper transaction handle: session.client = Bun.SQL pool.
  const sessionClient = propertyOf(propertyOf(db, "session"), "client");
  if (isRawClient(sessionClient)) return sessionClient;
  throw new Error(
    "asRawClient: db argument has no .unsafe() — pass a Bun.SQL pool or a transaction handle.",
  );
}

export function runnerCanBeginTransaction(db: unknown): boolean {
  return hasBegin(asRawClient(db));
}

function savepointRunnerOf<TRunner extends DbRunner>(sp: unknown): TRunner {
  // @cast-boundary db-runner savepoint handle → TRunner at the single seam (boundRunner re-wraps savepoint handles with the caller's capability)
  return sp as TRunner;
}

// Postgres aborts the whole transaction once a statement inside it errored
// (25P02 until rollback), even if the JS error was caught. Error confinement
// therefore goes through the driver's own savepoint(), not manual SAVEPOINT
// statements. The callback receives
// the savepoint-scoped tx; run every confined statement on THAT handle.
export function runInSavepoint<T>(
  tx: ExecutorManagedRunner,
  fn: (sp: ExecutorManagedRunner) => Promise<T>,
): Promise<T>;
export function runInSavepoint<T>(tx: unknown, fn: (sp: DbRunner) => Promise<T>): Promise<T>;
export async function runInSavepoint<T, TRunner extends DbRunner>(
  tx: unknown,
  fn: (sp: TRunner) => Promise<T>,
): Promise<T> {
  const raw = asRawClient(tx);
  if (!hasSavepoint(raw)) {
    throw new Error(
      "runInSavepoint: transaction handle has no savepoint() — pass the driver tx (Bun.SQL TransactionSQL).",
    );
  }
  return openSerializedSavepoint(raw, (sp) => fn(savepointRunnerOf<TRunner>(sp)));
}

// Same error-confinement as runInSavepoint, but for call sites that don't
// know whether `db` is a bare pool connection or an active transaction
// (e.g. the CRUD executor, invoked both from a dispatcher tx and directly
// against the pool by seeds/tests). A pool connection has no savepoint() —
// and doesn't need one, since each statement there is its own auto-committed
// unit and a failed statement can't poison anything downstream.
//
// `.savepoint` being present isn't proof the transaction is still open: a
// committed transaction handle still exposes `.savepoint`, and calling it
// fails (Bun.SQL: ERR_POSTGRES_INVALID_TRANSACTION_STATE, Postgres: 25P01)
// since there's no BEGIN left to nest into. That is now a programming error, not something
// to paper over by re-running `fn` without the savepoint's isolation.
const CONNECTION_CLOSED_CODE = "ERR_POSTGRES_CONNECTION_CLOSED";
const SAVEPOINT_ON_COMMITTED_CODES: ReadonlySet<string> = new Set([
  "25P01",
  "ERR_POSTGRES_INVALID_TRANSACTION_STATE",
]);

function isSavepointOnDeadTransactionCode(code: string | undefined): boolean {
  return (
    code !== undefined &&
    (code === CONNECTION_CLOSED_CODE || SAVEPOINT_ON_COMMITTED_CODES.has(code))
  );
}

export function runInSavepointIfSupported<T>(
  db: ExecutorManagedRunner,
  fn: (sp: ExecutorManagedRunner) => Promise<T>,
): Promise<T>;
export function runInSavepointIfSupported<T>(
  db: unknown,
  fn: (sp: DbRunner) => Promise<T>,
): Promise<T>;
export async function runInSavepointIfSupported<T, TRunner extends DbRunner>(
  db: unknown,
  fn: (sp: TRunner) => Promise<T>,
): Promise<T> {
  const raw = asRawClient(db);
  if (!hasSavepoint(raw)) return fn(savepointRunnerOf<TRunner>(db));
  // An error from inside fn must never be remapped, even if it carries a closed-connection code.
  let fnStarted = false;
  try {
    return await openSerializedSavepoint(raw, (sp) => {
      fnStarted = true;
      return fn(savepointRunnerOf<TRunner>(sp));
    });
  } catch (e) {
    const code = extractPgError(e)?.code;
    if (!fnStarted && isSavepointOnDeadTransactionCode(code)) {
      throw new InternalError({
        message:
          code === CONNECTION_CLOSED_CODE
            ? "runInSavepointIfSupported: the transaction handle's connection is gone — the transaction " +
              "already committed (almost always database work in an afterCommit hook) or the connection dropped. " +
              "afterCommit is the default phase of r.hook/postSave/postDelete. Use HookPhases.inTransaction " +
              "for writes that must roll back with the trigger, or ctx.db.outsideTransaction for work that must survive a rollback."
            : "runInSavepointIfSupported: savepoint on a transaction that has already committed — " +
              "this is almost always database work in an afterCommit hook. afterCommit is the default " +
              "phase of r.hook/postSave/postDelete. Use HookPhases.inTransaction for writes that must " +
              "roll back with the trigger, or ctx.db.outsideTransaction for work that must survive a rollback.",
        cause: e instanceof Error ? e : undefined,
      });
    }
    throw e;
  }
}

/**
 * When handlers call `selectMany(ctx.db, …)` instead of `ctx.db.selectMany(…)`,
 * unwrap via asRawClient would bypass TenantDb scoping. Duck-type TenantDb and
 * delegate so reads/writes keep tenant filter + tenantId injection.
 */
type TenantDbDelegate = {
  selectMany<TRow>(
    table: TableLike,
    where?: WhereObject,
    options?: SelectOptions,
  ): Promise<readonly TRow[]>;
  fetchOne<TRow>(table: TableLike, where: WhereObject): Promise<TRow | undefined>;
  insertOne<TRow>(table: TableLike, values: Record<string, unknown>): Promise<TRow | undefined>;
  updateMany<TRow>(
    table: TableLike,
    set: Record<string, unknown>,
    where: WhereObject,
  ): Promise<readonly TRow[]>;
  deleteMany(table: TableLike, where: WhereObject): Promise<number>;
  aggregate(
    table: TableLike,
    spec: AggregateSpec,
    where?: WhereObject,
  ): Promise<readonly AggregateRow[]>;
};

// Duck-types TenantDb: five scoped methods + tenantId, no `.unsafe` of its own.
// A throwing systemScope guard Proxy fails closed here too — intended, not a bug.
function isTenantDbShape(db: unknown): db is TenantDbDelegate {
  if (typeof db !== "object" || db === null) return false;
  if (typeof propertyOf(db, "unsafe") === "function") return false;
  return (
    typeof propertyOf(db, "selectMany") === "function" &&
    typeof propertyOf(db, "fetchOne") === "function" &&
    typeof propertyOf(db, "insertOne") === "function" &&
    typeof propertyOf(db, "updateMany") === "function" &&
    typeof propertyOf(db, "deleteMany") === "function" &&
    "tenantId" in db
  );
}

function tenantDbDelegate(db: unknown): TenantDbDelegate | undefined {
  return isTenantDbShape(db) ? db : undefined;
}

// Fails loudly for helpers that don't delegate to TenantDb (upsert/increment/insertMany) —
// passing one here would otherwise reach asRawClient and throw with a less specific message.
// @wrapper-known semantic-alias
function assertNotTenantScoped(db: unknown, fnName: string): void {
  if (tenantDbDelegate(db) !== undefined) {
    throw new Error(
      `${fnName}: received a tenant-scoped db but this helper does not apply the tenant filter. ` +
        "Pass ctx.db.unsafeRaw() (with escapeHatch: { reason } on the handler/hook) for an " +
        "explicit cross-tenant op, or use a scoped TenantDb method " +
        "(for an upsert: ctx.db.upsert(table, values, { conflictTarget })).",
    );
  }
}

export type AnyDb = DbRunner | unknown;

// biome-ignore lint/suspicious/noExplicitAny: opt-in default loosens row type for unannotated test fixtures
type AnyRow = any;

export type {
  JsonTextMatch,
  OrderByClause,
  SelectOptions,
  WhereObject,
  WhereOperator,
  WhereValue,
} from "@cosmicdrift/kumiko-types/where-clause-types";

// Accepts EITHER. Both have a tableName and field→column mapping.
// biome-ignore lint/suspicious/noExplicitAny: legacy drizzle pgTable surface
export type TableLike = EntityTableMeta | any;

export function coerceRow<TOut = Record<string, unknown>>(
  row: Record<string, unknown>,
  info: TableInfo,
): TOut {
  // @cast-boundary db-row — the driver row (raw column names/types) becomes the caller's entity row shape here, and only here
  return coerceDriverRow(row, info) as TOut;
}

function coerceRows<TOut>(
  rows: readonly Record<string, unknown>[],
  info: TableInfo,
): readonly TOut[] {
  return rows.map((r) => coerceRow<TOut>(r, info));
}

// Write and other non-retried paths: log when a closed-connection error leaves
// the db layer, rethrow unchanged.
export async function unsafeLoggingClosedConnection<TRow = unknown>(
  db: AnyDb,
  sqlText: string,
  params: readonly unknown[],
  context: ClosedConnectionContext,
): Promise<readonly TRow[]> {
  const raw = asRawClient(db);
  try {
    return await raw.unsafe<TRow>(sqlText, params);
  } catch (err) {
    logClosedConnection(raw, err, 1, context);
    throw err;
  }
}

// Exported so raw-SQL query modules outside the db layer (e.g. bundled-features'
// db/queries/*.ts) can opt into the same closed-connection retry instead of
// calling asRawClient(db).unsafe(...) directly and losing it.
// READS ONLY — retry re-executes the statement; never pass INSERT/UPDATE/DELETE.
export async function unsafeReadRetrying<TRow>(
  db: AnyDb,
  sqlText: string,
  params: readonly unknown[],
): Promise<readonly TRow[]> {
  const raw = asRawClient(db);
  try {
    return await raw.unsafe<TRow>(sqlText, params);
  } catch (err) {
    if (!isPooledClient(raw) || !isClosedConnectionError(err)) {
      logClosedConnection(raw, err, 1);
      throw err;
    }
    // Enough retries to flush every dead pooled connection plus one fresh one; total calls = maxRetries + 1.
    const maxRetries = poolMaxOf(raw) + 1;
    let lastErr: unknown = err;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await raw.unsafe<TRow>(sqlText, params);
      } catch (retryErr) {
        lastErr = retryErr;
        if (!isClosedConnectionError(retryErr)) {
          logClosedConnection(raw, retryErr, attempt + 2);
          throw retryErr;
        }
      }
    }
    logClosedConnection(raw, lastErr, maxRetries + 1);
    throw lastErr;
  }
}

function selectColumnList(info: TableInfo, fields: readonly string[] | undefined): string {
  if (fields === undefined) return "*";
  if (fields.length === 0) {
    throw new Error(`selectMany: fields must not be empty for "${info.name}"`);
  }
  return fields
    .map((field) => {
      if (!info.hasColumn(field)) {
        throw new Error(`selectMany: fields entry "${field}" is not a column of "${info.name}"`);
      }
      return quoteIdent(info.columnOf(field));
    })
    .join(", ");
}

export async function selectMany<TRow = AnyRow>(
  db: AnyDb,
  table: TableLike,
  where?: WhereObject,
  options?: SelectOptions,
): Promise<readonly TRow[]> {
  const scoped = tenantDbDelegate(db);
  if (scoped) {
    return scoped.selectMany<TRow>(table, where, options);
  }
  const info = extractTableInfo(table);
  const distinctOn = buildDistinctOnClause(info, options?.distinctOn, options?.orderBy);
  const distinctPrefix =
    distinctOn === undefined
      ? ""
      : `DISTINCT ON (${distinctOn.columns.map(quoteIdent).join(", ")}) `;
  let sqlText = `SELECT ${distinctPrefix}${selectColumnList(info, options?.fields)} FROM ${quoteIdent(info.name)}`;
  let values: unknown[] = [];
  if (where && Object.keys(where).length > 0) {
    const w = buildWhereClause(info, where, 1);
    sqlText += ` WHERE ${w.sqlText}`;
    values = w.values;
  }
  const orderBy = distinctOn?.orderBy ?? options?.orderBy;
  if (orderBy) {
    const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
    const parts = clauses.map((c) => {
      const col = info.columnOf(c.col);
      const dir = c.direction === "desc" ? "DESC" : "ASC";
      return `${quoteIdent(col)} ${dir}`;
    });
    if (parts.length > 0) sqlText += ` ORDER BY ${parts.join(", ")}`;
  }
  if (options?.limit !== undefined) {
    // Interpolated, not bound — guard against a non-integer slipping in via an
    // `any`-typed call site and injecting SQL.
    if (!Number.isInteger(options.limit) || options.limit < 0) {
      throw new Error(`selectMany: limit must be a non-negative integer, got ${options.limit}`);
    }
    sqlText += ` LIMIT ${options.limit}`;
  }
  const raw = await unsafeReadRetrying<Record<string, unknown>>(db, sqlText, values);
  return coerceRows<TRow>(raw, info);
}

export async function fetchOne<TRow = AnyRow>(
  db: AnyDb,
  table: TableLike,
  where: WhereObject,
): Promise<TRow | undefined> {
  const rows = await selectMany<TRow>(db, table, where, { limit: 1 });
  return rows[0];
}

export type JoinColumnPair = { readonly left: string; readonly right: string };

export type InnerJoinSpec = {
  readonly left: TableLike;
  readonly right: TableLike;
  readonly on: readonly [JoinColumnPair, ...JoinColumnPair[]];
  readonly leftWhere?: WhereObject;
  readonly rightWhere?: WhereObject;
  /** Fields to return per side; default: all columns of `left`, none of `right`. */
  readonly leftFields?: readonly string[];
  readonly rightFields?: readonly string[];
  readonly limit?: number;
};

export type InnerJoinRow<TLeft, TRight> = { readonly left: TLeft; readonly right: TRight };

const JOIN_LEFT_ALIAS = "l";
const JOIN_RIGHT_ALIAS = "r";

function requireJoinColumn(info: TableInfo, field: string, role: string): string {
  if (!info.hasColumn(field)) {
    throw new Error(`selectInnerJoin: ${role} "${field}" is not a column of "${info.name}"`);
  }
  return info.columnOf(field);
}

export async function selectInnerJoin<
  TLeft = Record<string, unknown>,
  TRight = Record<string, unknown>,
>(db: AnyDb, spec: InnerJoinSpec): Promise<readonly InnerJoinRow<TLeft, TRight>[]> {
  assertNotTenantScoped(db, "selectInnerJoin");
  const leftInfo = extractTableInfo(spec.left);
  const rightInfo = extractTableInfo(spec.right);
  if (spec.limit !== undefined && (!Number.isInteger(spec.limit) || spec.limit < 0)) {
    throw new Error(`selectInnerJoin: limit must be a non-negative integer, got ${spec.limit}`);
  }

  const leftColumns = (
    spec.leftFields ??
    requireEntityTableMeta(spec.left, "selectInnerJoin").columns.map((c) => c.name)
  ).map((field) => requireJoinColumn(leftInfo, field, "leftFields entry"));
  const rightColumns = (spec.rightFields ?? []).map((field) =>
    requireJoinColumn(rightInfo, field, "rightFields entry"),
  );

  // Positional aliases: a `<side>__<column>` scheme would hit Postgres' 63-byte
  // identifier truncation for long column names.
  const projected = [
    ...leftColumns.map((column) => ({ side: "left" as const, column })),
    ...rightColumns.map((column) => ({ side: "right" as const, column })),
  ];
  if (projected.length === 0) {
    throw new Error("selectInnerJoin: no columns selected");
  }
  const selectList = projected
    .map(
      ({ side, column }, index) =>
        `${quoteIdent(side === "left" ? JOIN_LEFT_ALIAS : JOIN_RIGHT_ALIAS)}.${quoteIdent(column)} AS "c${index}"`,
    )
    .join(", ");

  const onPairs = spec.on.map((pair) => {
    const leftColumn = requireJoinColumn(leftInfo, pair.left, "on.left");
    const rightColumn = requireJoinColumn(rightInfo, pair.right, "on.right");
    const leftRef = `${quoteIdent(JOIN_LEFT_ALIAS)}.${quoteIdent(leftColumn)}`;
    const rightRef = `${quoteIdent(JOIN_RIGHT_ALIAS)}.${quoteIdent(rightColumn)}`;
    return leftInfo.pgTypeOf(leftColumn) === rightInfo.pgTypeOf(rightColumn)
      ? `${leftRef} = ${rightRef}`
      : `${leftRef}::text = ${rightRef}::text`;
  });

  let sqlText =
    `SELECT ${selectList} FROM ${quoteIdent(leftInfo.name)} AS ${quoteIdent(JOIN_LEFT_ALIAS)} ` +
    `INNER JOIN ${quoteIdent(rightInfo.name)} AS ${quoteIdent(JOIN_RIGHT_ALIAS)} ON ${onPairs.join(" AND ")}`;

  const conditions: string[] = [];
  const values: unknown[] = [];
  if (spec.leftWhere && Object.keys(spec.leftWhere).length > 0) {
    const w = buildWhereClause(leftInfo, spec.leftWhere, values.length + 1, JOIN_LEFT_ALIAS);
    conditions.push(w.sqlText);
    values.push(...w.values);
  }
  if (spec.rightWhere && Object.keys(spec.rightWhere).length > 0) {
    const w = buildWhereClause(rightInfo, spec.rightWhere, values.length + 1, JOIN_RIGHT_ALIAS);
    conditions.push(w.sqlText);
    values.push(...w.values);
  }
  if (conditions.length > 0) sqlText += ` WHERE ${conditions.join(" AND ")}`;
  if (spec.limit !== undefined) sqlText += ` LIMIT ${spec.limit}`;

  const raw = await unsafeReadRetrying<Record<string, unknown>>(db, sqlText, values);
  return raw.map((row) => {
    const leftRow: Record<string, unknown> = {};
    const rightRow: Record<string, unknown> = {};
    projected.forEach(({ side, column }, index) => {
      (side === "left" ? leftRow : rightRow)[column] = row[`c${index}`];
    });
    return {
      left: coerceRow<TLeft>(leftRow, leftInfo),
      right: coerceRow<TRight>(rightRow, rightInfo),
    };
  });
}

// Bulk INSERT — same shape as insertOne but takes an array of rows and
// produces one multi-VALUES statement. Mirrors drizzle's
// `db.insert(t).values(rows[])`. Empty input is a no-op.
export function insertMany<TRow = AnyRow>(
  db: AnyDb,
  table: WritableTable,
  rows: ReadonlyArray<Record<string, unknown>>,
): Promise<readonly TRow[]>;
export function insertMany<TRow = AnyRow>(
  db: ExecutorManagedWriteCapability,
  table: EntityTableMeta,
  rows: ReadonlyArray<Record<string, unknown>>,
): Promise<readonly TRow[]>;
export async function insertMany<TRow = AnyRow>(
  db: AnyDb,
  table: EntityTableMeta,
  rows: ReadonlyArray<Record<string, unknown>>,
): Promise<readonly TRow[]> {
  if (rows.length === 0) return [];
  assertNotTenantScoped(db, "insertMany");
  const managedDenied = executorManagedWriteDenied(db, table, "insertMany");
  if (managedDenied) throw managedDenied;
  const info = extractTableInfo(table);
  // Use the column-set from the first row; assume all rows share keys.
  const firstRow = rows[0];
  if (firstRow === undefined) return [];
  // Filter out fields that don't exist as columns in the table (like drizzle did implicitly)
  const fields = Object.keys(firstRow).filter((k) => info.hasColumn(k));
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
      if (p.kind === "literal") {
        placeholders.push(p.literal);
      } else {
        params.push(p.bound);
        placeholders.push(`$${params.length}${p.sql}`);
      }
    }
    valuesClauses.push(`(${placeholders.join(", ")})`);
  }
  const sqlText = `INSERT INTO ${quoteIdent(info.name)} (${cols}) VALUES ${valuesClauses.join(", ")} RETURNING *`;
  const raw = await unsafeLoggingClosedConnection<Record<string, unknown>>(db, sqlText, params, {
    operation: "insertMany",
    table: info.name,
  });
  return coerceRows<TRow>(raw, info);
}

export function insertOne<TRow = AnyRow>(
  db: AnyDb,
  table: WritableTable,
  values: Record<string, unknown>,
): Promise<TRow | undefined>;
export function insertOne<TRow = AnyRow>(
  db: ExecutorManagedWriteCapability,
  table: EntityTableMeta,
  values: Record<string, unknown>,
): Promise<TRow | undefined>;
export async function insertOne<TRow = AnyRow>(
  db: AnyDb,
  table: EntityTableMeta,
  values: Record<string, unknown>,
): Promise<TRow | undefined> {
  const scoped = tenantDbDelegate(db);
  if (scoped) {
    return scoped.insertOne<TRow>(table, values);
  }
  const managedDenied = executorManagedWriteDenied(db, table, "insertOne");
  if (managedDenied) throw managedDenied;
  const info = extractTableInfo(table);
  const entries = insertEntries(info, values);
  if (entries.length === 0) throw new Error("insertOne: empty values object");
  const { sqlPrefix, params } = buildInsertSql(info, entries);
  const sqlText = `${sqlPrefix} RETURNING *`;
  const rows = await unsafeLoggingClosedConnection<Record<string, unknown>>(db, sqlText, params, {
    operation: "insertOne",
    table: info.name,
  });
  const first = rows[0];
  if (!first) return undefined;
  return coerceRow<TRow>(first, info);
}

export function updateMany<TRow = AnyRow>(
  db: AnyDb,
  table: WritableTable,
  set: Record<string, unknown>,
  where: WhereObject,
): Promise<readonly TRow[]>;
export function updateMany<TRow = AnyRow>(
  db: ExecutorManagedWriteCapability,
  table: EntityTableMeta,
  set: Record<string, unknown>,
  where: WhereObject,
): Promise<readonly TRow[]>;
export async function updateMany<TRow = AnyRow>(
  db: AnyDb,
  table: EntityTableMeta,
  set: Record<string, unknown>,
  where: WhereObject,
): Promise<readonly TRow[]> {
  const scoped = tenantDbDelegate(db);
  if (scoped) {
    return scoped.updateMany<TRow>(table, set, where);
  }
  const managedDenied = executorManagedWriteDenied(db, table, "updateMany");
  if (managedDenied) throw managedDenied;
  const info = extractTableInfo(table);
  const setEntries = Object.entries(set).map(([k, v]) => {
    const col = info.columnOf(k);
    const pgType = info.pgTypeOf(col);
    return { col, prepared: prepareValue(v, pgType) };
  });
  if (setEntries.length === 0) throw new Error("updateMany: empty set object");
  const values: unknown[] = [];
  let idx = 1;
  const setParts: string[] = [];
  for (const e of setEntries) {
    if (e.prepared.kind === "literal") {
      setParts.push(`${quoteIdent(e.col)} = ${e.prepared.literal}`);
    } else {
      setParts.push(`${quoteIdent(e.col)} = $${idx++}${e.prepared.sql}`);
      values.push(e.prepared.bound);
    }
  }
  const w = buildWhereClause(info, where, idx);
  let sqlText = `UPDATE ${quoteIdent(info.name)} SET ${setParts.join(", ")}`;
  if (w.sqlText) {
    sqlText += ` WHERE ${w.sqlText}`;
    for (const v of w.values) values.push(v);
  }
  sqlText += " RETURNING *";
  const raw = await unsafeLoggingClosedConnection<Record<string, unknown>>(db, sqlText, values, {
    operation: "updateMany",
    table: info.name,
  });
  return coerceRows<TRow>(raw, info);
}

export function deleteMany(db: AnyDb, table: WritableTable, where: WhereObject): Promise<number>;
export function deleteMany(
  db: ExecutorManagedWriteCapability,
  table: EntityTableMeta,
  where: WhereObject,
): Promise<number>;
export async function deleteMany(
  db: AnyDb,
  table: EntityTableMeta,
  where: WhereObject,
): Promise<number> {
  const scoped = tenantDbDelegate(db);
  if (scoped) {
    return scoped.deleteMany(table, where);
  }
  const managedDenied = executorManagedWriteDenied(db, table, "deleteMany");
  if (managedDenied) throw managedDenied;
  const info = extractTableInfo(table);
  const w = buildWhereClause(info, where, 1);
  let sqlText = `DELETE FROM ${quoteIdent(info.name)}`;
  if (w.sqlText) sqlText += ` WHERE ${w.sqlText}`;
  const result = await unsafeLoggingClosedConnection(db, sqlText, w.values, {
    operation: "deleteMany",
    table: info.name,
  });
  // Bun.SQL reports the affected-row count of a DELETE on the result, no RETURNING needed.
  const count = propertyOf(result, "count");
  if (typeof count !== "number") {
    throw new Error(`deleteMany(${info.name}): the driver result carries no affected-row count`);
  }
  return count;
}

export type InsertEntry = {
  readonly field: string;
  readonly col: string;
  readonly prepared: PreparedValue;
};

export function insertEntries(info: TableInfo, values: Record<string, unknown>): InsertEntry[] {
  return Object.entries(values)
    .filter(([k]) => info.hasColumn(k))
    .map(([k, v]) => {
      const col = info.columnOf(k);
      return { field: k, col, prepared: prepareValue(v, info.pgTypeOf(col)) };
    });
}

// Exported for the shadow-proof regression test — `table.columns` would be the
// drizzle handle (not the PK list) when an entity has a field named `columns`.
export function resolveConflictColumns(
  table: TableLike,
  info: TableInfo,
  conflictKeys: readonly string[] | undefined,
): readonly string[] {
  if (conflictKeys !== undefined && conflictKeys.length > 0) {
    return conflictKeys.map((field) => info.columnOf(field));
  }
  // Read the shadow-proof meta — `table.columns` directly would be the handle
  // object when an entity has a field named `columns`.
  const meta = asEntityTableMeta(table);
  if (meta) {
    const pks = meta.columns.filter((c) => c.primaryKey).map((c) => c.name);
    if (pks.length > 0) return pks;
  }
  if (info.hasColumn("id")) return [info.columnOf("id")];
  throw new Error("upsert: cannot infer conflict keys — pass conflictKeys explicitly");
}

// Appends bound values to `params`; `skipCols` only applies to the default EXCLUDED set.
export function conflictUpdateParts(
  info: TableInfo,
  entries: readonly InsertEntry[],
  update: Record<string, unknown> | undefined,
  skipCols: ReadonlySet<string>,
  params: unknown[],
): string[] {
  const parts: string[] = [];
  if (update === undefined) {
    for (const e of entries) {
      if (skipCols.has(e.col)) continue;
      parts.push(`${quoteIdent(e.col)} = EXCLUDED.${quoteIdent(e.col)}`);
    }
    return parts;
  }
  for (const [field, value] of Object.entries(update)) {
    const col = info.columnOf(field);
    const p = prepareValue(value, info.pgTypeOf(col));
    if (p.kind === "literal") {
      parts.push(`${quoteIdent(col)} = ${p.literal}`);
    } else {
      params.push(p.bound);
      parts.push(`${quoteIdent(col)} = $${params.length}${p.sql}`);
    }
  }
  return parts;
}

export function buildInsertSql(
  info: TableInfo,
  entries: readonly InsertEntry[],
): { sqlPrefix: string; params: unknown[] } {
  if (entries.length === 0) throw new Error("insert: empty values object");
  const cols = entries.map((e) => quoteIdent(e.col)).join(", ");
  const params: unknown[] = [];
  const placeholders = entries
    .map((e) => {
      if (e.prepared.kind === "literal") return e.prepared.literal;
      params.push(e.prepared.bound);
      return `$${params.length}${e.prepared.sql}`;
    })
    .join(", ");
  const sqlPrefix = `INSERT INTO ${quoteIdent(info.name)} (${cols}) VALUES (${placeholders})`;
  return { sqlPrefix, params };
}

export type UpsertOnConflictOptions = {
  readonly conflictKeys: readonly string[];
  /** Columns to set on conflict. Default: EXCLUDED for every inserted non-key column. */
  readonly update?: Record<string, unknown>;
};

export type DeleteManyBatchedOptions = {
  readonly limit: number;
  readonly maxBatches?: number;
  /** Row id field for the LIMIT subquery. Default `id`. */
  readonly idColumn?: string;
};

export type DeleteManyBatchedResult = {
  readonly deleted: number;
  readonly batches: number;
};

export async function countWhere(
  db: AnyDb,
  table: TableLike,
  where: WhereObject = {},
): Promise<number> {
  const info = extractTableInfo(table);
  let sqlText = `SELECT COUNT(*)::int AS count FROM ${quoteIdent(info.name)}`;
  let values: unknown[] = [];
  if (Object.keys(where).length > 0) {
    const w = buildWhereClause(info, where, 1);
    sqlText += ` WHERE ${w.sqlText}`;
    values = w.values;
  }
  const rows = await unsafeReadRetrying<{ count: number }>(db, sqlText, values);
  return rows[0]?.count ?? 0;
}

export async function aggregateWhere(
  db: AnyDb,
  table: TableLike,
  spec: AggregateSpec,
  where: WhereObject = {},
): Promise<readonly AggregateRow[]> {
  const scoped = tenantDbDelegate(db);
  if (scoped) {
    return scoped.aggregate(table, spec, where);
  }
  const info = extractTableInfo(table);
  const params: unknown[] = [];
  const measureSql = aggregateMeasureSql(info, spec.measure);
  const dimensions = spec.groupBy ?? [];
  const dimensionSql = dimensions.map((dimension, index) =>
    aggregateDimensionSql(info, dimension, index, params),
  );
  assertValidAggregateLimits(spec);

  const selectList = [...dimensionSql, `(${measureSql})::float8 AS value`].join(", ");
  let sqlText = `SELECT ${selectList} FROM ${quoteIdent(info.name)}`;
  if (Object.keys(where).length > 0) {
    const w = buildWhereClause(info, where, params.length + 1);
    sqlText += ` WHERE ${w.sqlText}`;
    params.push(...w.values);
  }
  sqlText += aggregateGroupOrderLimitSql(spec, dimensions.length);

  const raw = await unsafeReadRetrying<Record<string, unknown>>(db, sqlText, params);
  return raw.map((row) => {
    const value = row["value"];
    return {
      keys: dimensions.map((_, index) => aggregateKeyOf(row[`k${index}`])),
      value: value === null || value === undefined ? null : Number(value),
    };
  });
}

export function upsertOnConflict<TRow = AnyRow>(
  db: AnyDb,
  table: WritableTable,
  values: Record<string, unknown>,
  options: UpsertOnConflictOptions,
): Promise<TRow | undefined>;
export function upsertOnConflict<TRow = AnyRow>(
  db: ExecutorManagedWriteCapability,
  table: EntityTableMeta,
  values: Record<string, unknown>,
  options: UpsertOnConflictOptions,
): Promise<TRow | undefined>;
export function upsertOnConflict<TRow = AnyRow>(
  db: AnyDb,
  table: EntityTableMeta,
  values: Record<string, unknown>,
  options: UpsertOnConflictOptions,
): Promise<TRow | undefined> {
  return upsertOnConflictChecked<TRow>(db, table, values, options);
}

// upsertByPk shares this body; the checks inside gate the write, so it needs no overload pair.
async function upsertOnConflictChecked<TRow>(
  db: AnyDb,
  table: EntityTableMeta,
  values: Record<string, unknown>,
  options: UpsertOnConflictOptions,
): Promise<TRow | undefined> {
  assertNotTenantScoped(db, "upsertOnConflict");
  const managedDenied = executorManagedWriteDenied(db, table, "upsertOnConflict");
  if (managedDenied) throw managedDenied;
  const info = extractTableInfo(table);
  const entries = insertEntries(info, values);
  const conflictCols = resolveConflictColumns(table, info, options.conflictKeys);
  const conflictSet = new Set(conflictCols);
  const { sqlPrefix, params } = buildInsertSql(info, entries);

  const updateParts = conflictUpdateParts(info, entries, options.update, conflictSet, params);

  if (updateParts.length === 0) {
    throw new Error("upsertOnConflict: nothing to update on conflict");
  }

  const conflictList = conflictCols.map((c) => quoteIdent(c)).join(", ");
  const sqlText = `${sqlPrefix} ON CONFLICT (${conflictList}) DO UPDATE SET ${updateParts.join(", ")} RETURNING *`;
  const rows = await unsafeLoggingClosedConnection<Record<string, unknown>>(db, sqlText, params, {
    operation: "upsertOnConflict",
    table: info.name,
  });
  const first = rows[0];
  if (!first) return undefined;
  return coerceRow<TRow>(first, info);
}

export function upsertByPk<TRow = AnyRow>(
  db: AnyDb,
  table: WritableTable,
  values: Record<string, unknown>,
  updateOnConflict?: Record<string, unknown>,
): Promise<TRow | undefined>;
export function upsertByPk<TRow = AnyRow>(
  db: ExecutorManagedWriteCapability,
  table: EntityTableMeta,
  values: Record<string, unknown>,
  updateOnConflict?: Record<string, unknown>,
): Promise<TRow | undefined>;
export async function upsertByPk<TRow = AnyRow>(
  db: AnyDb,
  table: EntityTableMeta,
  values: Record<string, unknown>,
  updateOnConflict?: Record<string, unknown>,
): Promise<TRow | undefined> {
  const managedDenied = executorManagedWriteDenied(db, table, "upsertByPk");
  if (managedDenied) throw managedDenied;
  const info = extractTableInfo(table);
  const conflictKeys = resolveConflictColumns(table, info, undefined);
  const fieldKeys = conflictKeys.map((col) => info.fieldOf(col));
  return upsertOnConflictChecked<TRow>(db, table, values, {
    conflictKeys: fieldKeys,
    ...(updateOnConflict !== undefined ? { update: updateOnConflict } : {}),
  });
}

export type InsertOnConflictDoNothingOptions = { readonly conflictKeys?: readonly string[] };

export function insertOnConflictDoNothing<TRow = AnyRow>(
  db: AnyDb,
  table: WritableTable,
  values: Record<string, unknown>,
  options?: InsertOnConflictDoNothingOptions,
): Promise<TRow | undefined>;
export function insertOnConflictDoNothing<TRow = AnyRow>(
  db: ExecutorManagedWriteCapability,
  table: EntityTableMeta,
  values: Record<string, unknown>,
  options?: InsertOnConflictDoNothingOptions,
): Promise<TRow | undefined>;
export async function insertOnConflictDoNothing<TRow = AnyRow>(
  db: AnyDb,
  table: EntityTableMeta,
  values: Record<string, unknown>,
  options?: InsertOnConflictDoNothingOptions,
): Promise<TRow | undefined> {
  assertNotTenantScoped(db, "insertOnConflictDoNothing");
  const managedDenied = executorManagedWriteDenied(db, table, "insertOnConflictDoNothing");
  if (managedDenied) throw managedDenied;
  const info = extractTableInfo(table);
  const entries = insertEntries(info, values);
  const conflictCols = resolveConflictColumns(table, info, options?.conflictKeys);
  const { sqlPrefix, params } = buildInsertSql(info, entries);
  const conflictList = conflictCols.map((c) => quoteIdent(c)).join(", ");
  const sqlText = `${sqlPrefix} ON CONFLICT (${conflictList}) DO NOTHING RETURNING *`;
  const rows = await unsafeLoggingClosedConnection<Record<string, unknown>>(db, sqlText, params, {
    operation: "insertOnConflictDoNothing",
    table: info.name,
  });
  const first = rows[0];
  if (!first) return undefined;
  return coerceRow<TRow>(first, info);
}

export type IncrementCounterOptions = {
  readonly conflictKeys?: readonly string[];
  /** Extra SET clauses on conflict (e.g. lastUpdatedAt: sql\`NOW()\`). */
  readonly set?: Record<string, unknown>;
};

export function incrementCounter<TRow = AnyRow>(
  db: AnyDb,
  table: WritableTable,
  values: Record<string, unknown>,
  increments: Record<string, number>,
  options?: IncrementCounterOptions,
): Promise<TRow | undefined>;
export function incrementCounter<TRow = AnyRow>(
  db: ExecutorManagedWriteCapability,
  table: EntityTableMeta,
  values: Record<string, unknown>,
  increments: Record<string, number>,
  options?: IncrementCounterOptions,
): Promise<TRow | undefined>;
export async function incrementCounter<TRow = AnyRow>(
  db: AnyDb,
  table: EntityTableMeta,
  values: Record<string, unknown>,
  increments: Record<string, number>,
  options: IncrementCounterOptions = {},
): Promise<TRow | undefined> {
  assertNotTenantScoped(db, "incrementCounter");
  const managedDenied = executorManagedWriteDenied(db, table, "incrementCounter");
  if (managedDenied) throw managedDenied;
  const info = extractTableInfo(table);
  const entries = insertEntries(info, values);
  const conflictCols = resolveConflictColumns(table, info, options.conflictKeys);
  const conflictSet = new Set(conflictCols);
  const { sqlPrefix, params } = buildInsertSql(info, entries);
  const tableQ = quoteIdent(info.name);

  const updateParts: string[] = [];
  let idx = params.length + 1;

  for (const [field, delta] of Object.entries(increments)) {
    const col = info.columnOf(field);
    updateParts.push(`${quoteIdent(col)} = ${tableQ}.${quoteIdent(col)} + $${idx++}`);
    params.push(delta);
  }

  if (options.set !== undefined) {
    for (const [field, value] of Object.entries(options.set)) {
      const col = info.columnOf(field);
      const p = prepareValue(value, info.pgTypeOf(col));
      if (p.kind === "literal") {
        updateParts.push(`${quoteIdent(col)} = ${p.literal}`);
      } else {
        updateParts.push(`${quoteIdent(col)} = $${idx++}${p.sql}`);
        params.push(p.bound);
      }
    }
  }

  for (const e of entries) {
    if (conflictSet.has(e.col)) continue;
    if (Object.hasOwn(increments, e.field)) continue;
    if (options.set !== undefined && Object.hasOwn(options.set, e.field)) continue;
    updateParts.push(`${quoteIdent(e.col)} = EXCLUDED.${quoteIdent(e.col)}`);
  }

  if (updateParts.length === 0) {
    throw new Error("incrementCounter: nothing to update on conflict");
  }

  const conflictList = conflictCols.map((c) => quoteIdent(c)).join(", ");
  const sqlText = `${sqlPrefix} ON CONFLICT (${conflictList}) DO UPDATE SET ${updateParts.join(", ")} RETURNING *`;
  const rows = await unsafeLoggingClosedConnection<Record<string, unknown>>(db, sqlText, params, {
    operation: "incrementCounter",
    table: info.name,
  });
  const first = rows[0];
  if (!first) return undefined;
  return coerceRow<TRow>(first, info);
}

export function deleteManyBatched(
  db: AnyDb,
  table: WritableTable,
  where: WhereObject,
  options: DeleteManyBatchedOptions,
): Promise<DeleteManyBatchedResult>;
export function deleteManyBatched(
  db: ExecutorManagedWriteCapability,
  table: EntityTableMeta,
  where: WhereObject,
  options: DeleteManyBatchedOptions,
): Promise<DeleteManyBatchedResult>;
export async function deleteManyBatched(
  db: AnyDb,
  table: EntityTableMeta,
  where: WhereObject,
  options: DeleteManyBatchedOptions,
): Promise<DeleteManyBatchedResult> {
  const managedDenied = executorManagedWriteDenied(db, table, "deleteManyBatched");
  if (managedDenied) throw managedDenied;
  const info = extractTableInfo(table);
  const w = buildWhereClause(info, where, 1);
  if (!w.sqlText) {
    throw new Error("deleteManyBatched: where clause required — refusing unbounded batch delete");
  }
  const limit = options.limit;
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error("deleteManyBatched: limit must be a positive number");
  }
  const idField = options.idColumn ?? "id";
  const idCol = info.columnOf(idField);
  const tableQ = quoteIdent(info.name);
  const idQ = quoteIdent(idCol);
  const maxBatches = options.maxBatches ?? Number.POSITIVE_INFINITY;

  let deleted = 0;
  let batches = 0;

  while (batches < maxBatches) {
    const limitIdx = w.values.length + 1;
    const params = [...w.values, limit];
    const sqlText = `DELETE FROM ${tableQ} WHERE ${idQ} IN (
      SELECT ${idQ} FROM ${tableQ} WHERE ${w.sqlText} LIMIT $${limitIdx}
    ) RETURNING ${idQ}`;
    const rows = await unsafeLoggingClosedConnection(db, sqlText, params, {
      operation: "deleteManyBatched",
      table: info.name,
    });
    batches++;
    deleted += rows.length;
    if (rows.length < limit) break;
  }

  return { deleted, batches };
}

function beginnableClientOrThrow(db: unknown, caller: string): RawClientWithBegin {
  const raw = asRawClient(db);
  if (!hasBegin(raw)) {
    throw new InternalError({
      message: `${caller}: runner has no begin() — already inside a transaction or savepoint.`,
    });
  }
  return raw;
}

export async function transaction<T>(db: AnyDb, fn: (tx: DbTx) => Promise<T>): Promise<T> {
  return beginnableClientOrThrow(db, "transaction").begin(fn);
}

// A tx/savepoint handle has no begin(); fail closed instead of nesting silently or TypeError-ing.
export async function runInNewTransaction<T>(
  db: unknown,
  fn: (tx: DbRunner) => Promise<T>,
): Promise<T> {
  return beginnableClientOrThrow(db, "runInNewTransaction").begin(fn);
}
