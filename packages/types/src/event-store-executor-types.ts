import type { CursorResult } from "./cursor-types";
import type { SessionUser, WriteResult } from "./handlers";
import type { DeleteContext, SaveContext } from "./hooks";
import type { EntityId } from "./identifiers";
import type { SearchAdapter } from "./search-adapter";
import type { TenantDb } from "./tenant-db-types";

export type EventStoreExecutor = {
  create: (
    payload: Record<string, unknown>,
    user: SessionUser,
    db: TenantDb,
  ) => Promise<WriteResult<SaveContext>>;

  update: (
    payload: { id: EntityId; version?: number | undefined; changes: Record<string, unknown> },
    user: SessionUser,
    db: TenantDb,
    options?: { skipOptimisticLock?: boolean; skipUnchanged?: boolean },
  ) => Promise<WriteResult<SaveContext>>;

  delete: (
    payload: { id: EntityId },
    user: SessionUser,
    db: TenantDb,
  ) => Promise<WriteResult<DeleteContext>>;

  // Hard-purge (Art. 17 erasure). Like delete, but emits `<entity>.forgotten`
  // which hard-deletes the row even for softDelete entities — and, being an
  // auto-verb replayed by the implicit projection, the erasure survives a
  // rebuild (created → forgotten → row gone). Reaches soft-deleted rows too.
  forget: (
    payload: { id: EntityId },
    user: SessionUser,
    db: TenantDb,
  ) => Promise<WriteResult<DeleteContext>>;

  restore: (
    payload: { id: EntityId },
    user: SessionUser,
    db: TenantDb,
  ) => Promise<WriteResult<SaveContext>>;

  list: (
    payload: {
      cursor?: string | undefined;
      limit?: number | undefined;
      search?: string | undefined;
      sort?: string | undefined;
      sortDirection?: "asc" | "desc" | undefined;
      offset?: number | undefined;
      totalCount?: boolean | undefined;
      filter?:
        | {
            readonly field: string;
            readonly op: "eq" | "ne" | "lt" | "gt" | "in";
            readonly value: unknown;
          }
        | undefined;
      // User-chosen faceted filters (dynamic, additive to the static
      // `filter`). All combined with AND.
      filters?:
        | ReadonlyArray<{
            readonly field: string;
            readonly op: "eq" | "ne" | "lt" | "gt" | "in";
            readonly value: unknown;
          }>
        | undefined;
    },
    user: SessionUser,
    db: TenantDb,
    /** Tier 2.7e audit fix: per-call SearchAdapter override. When the
     *  executor didn't get a SearchAdapter via Options at build time
     *  (defaultEntityQueryHandler path), the caller (handler) can pass
     *  one from ctx.searchAdapter here at runtime.
     *  options.searchAdapter (build-time) wins — the runtime override
     *  is the fallback for the default wrapper. */
    runtimeOptions?: {
      readonly searchAdapter?: SearchAdapter;
      // Trash query: skip the implicit `isDeleted = FALSE` filter so soft-
      // deleted rows are returned too. Tenant + ownership clauses still apply
      // — includeDeleted only relaxes the soft-delete predicate, never the
      // visibility ones, so it can ride untrusted query input safely.
      readonly includeDeleted?: boolean;
    },
  ) => Promise<CursorResult<Record<string, unknown>>>;

  detail: (
    payload: { id: EntityId },
    user: SessionUser,
    db: TenantDb,
  ) => Promise<Record<string, unknown> | null>;
};
