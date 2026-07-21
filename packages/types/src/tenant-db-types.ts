import type { DbRunner } from "./db-connection";
import type { EntityTableMeta } from "./entity-table-meta-types";
import type { NotExecutorOnly } from "./executor-brand";
import type { TenantId } from "./identifiers";
import type { SchemaTable } from "./schema-table-types";
import type { SelectOptions, WhereObject } from "./where-clause-types";

// Method-form writes reject the executor-only brand exactly like the free-function
// helpers (#742): a managed EntityTable is a rebuildable projection, so writing it
// directly — free-function OR method-form — drifts the row past its event stream and
// a rebuild wipes it. The permissive base stays (raw pgTables AND unmanaged entity
// metas are not projections → writable); `& NotExecutorOnly` strips only branded
// EntityTables (its `[EXECUTOR_ONLY]: true` violates the optional-never). Reads keep
// the plain `SchemaTable` param.
type WritableTable = (SchemaTable | EntityTableMeta) & NotExecutorOnly;

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
   * Underlying DbRunner. Framework-internal use (event-store, migrations) —
   * bypasses tenant-filter. Feature code uses the typed helpers above so the
   * automatic scoping stays intact.
   */
  readonly raw: DbRunner;
  selectMany<T = Record<string, unknown>>(
    table: SchemaTable,
    where?: WhereObject,
    options?: SelectOptions,
  ): Promise<readonly T[]>;
  fetchOne<T = Record<string, unknown>>(
    table: SchemaTable,
    where: WhereObject,
  ): Promise<T | undefined>;
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
