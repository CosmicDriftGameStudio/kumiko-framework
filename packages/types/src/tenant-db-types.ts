import type { AggregateRow, AggregateSpec } from "./aggregate-types.ts";
import type { DbRunner } from "./db-connection.ts";
import type { EntityTableMeta } from "./entity-table-meta-types.ts";
import type { ExecutorManagedWriteCapability, Writable, WritableTable } from "./executor-brand.ts";
import type { TenantId } from "./identifiers.ts";
import type { SchemaTable } from "./schema-table-types.ts";
import type { TenancyBrand } from "./tenancy-brand.ts";
import type { SelectOptions, WhereObject } from "./where-clause-types.ts";

// db.global(table)'s surface: reads are unrestricted; writes require the table's Writable brand
// (a managed EntityTable lacks it, so it can only be written by the executor).
type GlobalReads = {
  selectMany<T = Record<string, unknown>>(
    where?: WhereObject,
    options?: SelectOptions,
  ): Promise<readonly T[]>;
  fetchOne<T = Record<string, unknown>>(where: WhereObject): Promise<T | undefined>;
};
type GlobalWrites = {
  insertOne<T = Record<string, unknown>>(values: Record<string, unknown>): Promise<T | undefined>;
  updateMany<T = Record<string, unknown>>(
    set: Record<string, unknown>,
    where: WhereObject,
  ): Promise<readonly T[]>;
  deleteMany(where: WhereObject): Promise<void>;
};
export type GlobalTableDb<TTable> = GlobalReads &
  (TTable extends Writable ? GlobalWrites : unknown);

/**
 * TenantDb scope modes:
 *
 * - "tenant" (default): SELECT/UPDATE/DELETE filtered by tenantId + reference data (tenantId=SYSTEM_TENANT_ID).
 *   INSERT forces tenantId — handler cannot override.
 *
 * - "system" (r.systemScope()): No tenant filter on reads/updates/deletes.
 *   INSERT uses tenantId as default but handler can override.
 *
 * Tables without a tenantId column are always unfiltered regardless of mode.
 */
export type TenantDbMode = "tenant" | "system";

// Read-only, tenant-unfiltered subset of TenantDb for jobs that declared the unsafeRaw grant.
export type CrossTenantReads = Pick<TenantDb, "selectMany" | "fetchOne" | "count">;

// Generic over the table so ExecutorManagedTenantDb can accept event-fed tables; the plain
// TenantDb only accepts Writable ones.
export type TenantDbWrites<TTable> = {
  insertOne<T = Record<string, unknown>>(
    table: TTable,
    values: Record<string, unknown>,
  ): Promise<T | undefined>;
  updateMany<T = Record<string, unknown>>(
    table: TTable,
    set: Record<string, unknown>,
    where: WhereObject,
  ): Promise<readonly T[]>;
  // Resolves to the number of deleted rows.
  deleteMany(table: TTable, where: WhereObject): Promise<number>;
};

type TenantDbNonWrites = {
  readonly tenantId: TenantId;
  readonly mode: TenantDbMode;
  /**
   * Unfiltered DbRunner escape hatch for handlers/hooks that declare `escapeHatch: { reason }`.
   * Throws `AccessDeniedError` when ungranted. The audit entry carries the declared escapeHatch reason.
   */
  unsafeRaw(): DbRunner;
  /**
   * Reach a "global" table with the tenant filter lifted — reads always work; writes
   * reject unless the write handler declared `escapeHatch: { reason }`. "tenant"-tenancy is a compile error here.
   */
  global<TTable extends (SchemaTable | EntityTableMeta) & TenancyBrand<"global">>(
    table: TTable,
  ): GlobalTableDb<TTable>;
  selectMany<T = Record<string, unknown>>(
    table: SchemaTable | EntityTableMeta,
    where?: WhereObject,
    options?: SelectOptions,
  ): Promise<readonly T[]>;
  fetchOne<T = Record<string, unknown>>(
    table: SchemaTable | EntityTableMeta,
    where: WhereObject,
  ): Promise<T | undefined>;
  count(table: SchemaTable | EntityTableMeta, where?: WhereObject): Promise<number>;
  /**
   * Transaction-scoped advisory lock keyed on (namespace, this handle's tenantId + key); released at
   * commit or rollback. Keys of different tenants never contend. Only serialises inside a transaction.
   */
  advisoryXactLock(namespace: number, key: string): Promise<void>;
  /** Postgres `now()`; inside a transaction this is the transaction start. */
  databaseNow(): Promise<Date>;
  aggregate(
    table: SchemaTable | EntityTableMeta,
    spec: AggregateSpec,
    where?: WhereObject,
  ): Promise<readonly AggregateRow[]>;
  // conflictTarget must include tenantId; the update only touches rows of the inserted tenant.
  // Rejected at runtime on event-fed tables, even for ExecutorManagedTenantDb.
  upsert<T = Record<string, unknown>>(
    table: WritableTable,
    values: Record<string, unknown>,
    options: TenantDbUpsertOptions,
  ): Promise<T | undefined>;
};

export type TenantDbUpsertOptions = {
  readonly conflictTarget: readonly string[];
  readonly update?: Record<string, unknown>;
};

export type TenantDb = TenantDbNonWrites & TenantDbWrites<WritableTable>;

// Handle for apply/rebuild/tenant-destroy contexts: may also write event-fed tables.
export type ExecutorManagedTenantDb = TenantDbNonWrites &
  TenantDbWrites<EntityTableMeta> &
  ExecutorManagedWriteCapability;

// Symbol.for (global registry) so the brand identity matches even if kumiko-types
// resolves to two independent copies (workspace symlink vs. published npm) — a plain
// `Symbol()` per copy would make each resolution's `UncheckedSystemDb` structurally
// incompatible with the other, per the kumiko.secret precedent in secrets-types.ts.
export const SYSTEM_SCOPE_CHECK_BRAND: unique symbol = Symbol.for("kumiko.system-scope-check");

export type UncheckedSystemDb = {
  readonly [SYSTEM_SCOPE_CHECK_BRAND]: true;
  assertTenantMatch(tenantId: TenantId): TenantDb;
  assertRowsTenant<T>(rows: readonly T[], tenantField: keyof T): readonly T[];
  acknowledgeCrossTenant(reason: string): TenantDb;
  /**
   * Raw unfiltered DbRunner, gated behind a mandatory non-empty `reason` for auditability.
   * Throws on an empty (or whitespace-only) reason.
   */
  unsafeRaw(reason: string): DbRunner;
  // Same self-check pair as above, but hands back the caller's
  // ctx.dbOutsideTransaction TenantDb instead of the in-tx one — for
  // durability writes that must survive a rollback of the handler's own
  // transaction. Throws if the dispatch has no outside-transaction source
  // configured (e.g. a hand-built UncheckedSystemDb that only ever passed
  // the in-tx db, as createSystemDbView callers do).
  readonly outsideTransaction: {
    assertTenantMatch(tenantId: TenantId): TenantDb;
    acknowledgeCrossTenant(reason: string): TenantDb;
  };
};
