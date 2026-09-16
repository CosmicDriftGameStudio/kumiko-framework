import type { DbRunner } from "./db-connection";
import type { EntityTableMeta } from "./entity-table-meta-types";
import type { ExecutorOnly, NotExecutorOnly } from "./executor-brand";
import type { TenantId } from "./identifiers";
import type { SchemaTable } from "./schema-table-types";
import type { TenancyBrand } from "./tenancy-brand";
import type { SelectOptions, WhereObject } from "./where-clause-types";

// Method-form writes reject the executor-only brand exactly like the free-function
// helpers (#742): a managed EntityTable is a rebuildable projection, so writing it
// directly — free-function OR method-form — drifts the row past its event stream and
// a rebuild wipes it. The permissive base stays (raw pgTables AND unmanaged entity
// metas are not projections → writable); `& NotExecutorOnly` strips only branded
// EntityTables (its `[EXECUTOR_ONLY]: true` violates the optional-never). Reads keep
// the plain `SchemaTable` param.
type WritableTable = (SchemaTable | EntityTableMeta) & NotExecutorOnly;

// db.global(table)'s surface: reads are unrestricted; writes require the managed
// EntityTable's executor-only brand to be absent (mirrors WritableTable above).
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
// Checks `extends ExecutorOnly`, not `NotExecutorOnly` — the latter's optional-never
// property is a TS "weak type" that would silently collapse every TTable to GlobalReads.
export type GlobalTableDb<TTable> = GlobalReads &
  (TTable extends ExecutorOnly ? unknown : GlobalWrites);

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

export type TenantDb = {
  readonly tenantId: TenantId;
  readonly mode: TenantDbMode;
  /**
   * Unfiltered DbRunner escape hatch for handlers/hooks that declare `escapeHatch: { reason }`.
   * Throws `AccessDeniedError` when ungranted, or `Error` when `reason` is empty.
   */
  unsafeRaw(reason: string): DbRunner;
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
  insertOne<T = Record<string, unknown>>(
    table: WritableTable,
    values: Record<string, unknown>,
  ): Promise<T | undefined>;
  updateMany<T = Record<string, unknown>>(
    table: WritableTable,
    set: Record<string, unknown>,
    where: WhereObject,
  ): Promise<readonly T[]>;
  deleteMany(table: WritableTable, where: WhereObject): Promise<void>;
};

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
  // the in-tx db to createUncheckedSystemDb).
  readonly outsideTransaction: {
    assertTenantMatch(tenantId: TenantId): TenantDb;
    acknowledgeCrossTenant(reason: string): TenantDb;
  };
};
