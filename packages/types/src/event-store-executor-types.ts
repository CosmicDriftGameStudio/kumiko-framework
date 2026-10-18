import type { CursorResult } from "./cursor-types.ts";
import type { EntityDefinition } from "./fields.ts";
import type { SessionUser, WriteResult } from "./handlers.ts";
import type { DeleteContext, SaveContext } from "./hooks.ts";
import type { EntityId, TenantId } from "./identifiers.ts";
import type { SearchAdapter } from "./search-adapter.ts";
import type { TenantDb } from "./tenant-db-types.ts";

// Read-time gate for join-row entities (EntityDefinition.parentRef): the
// registered-entity map the SQL clause checks host candidates against.
// Lives here (not in db/parent-ref-clause.ts) because the Registry only
// exists at request time — the same extension-point shape as
// referenceSearch/referenceSort below (fw#2660/fw#2741).
export type ParentVisibilityOption = {
  readonly entities: ReadonlyMap<string, EntityDefinition>;
};

// Runs the caller's preSave hooks against changes not yet persisted, for
// the executor's create()/update() only — restore/delete/forget have no
// `changes` to shape. See HandlerContext.runPreSave for how this gets bound
// to a specific handler name + AppContext.
export type PreSaveRunner = (
  changes: Record<string, unknown>,
  previous: Readonly<Record<string, unknown>>,
  isNew: boolean,
) => Promise<Record<string, unknown>>;

// Cross-tenant verbs on a foreign row (create: into the target tenant's stream): stream, event tenant and PII key follow the row's tenant
// while the acting user stays the operator. Honored on a system-mode db or a tenant-mode db bound
// to exactly that tenant (ctx.forTenant). update/delete/restore: must equal the loaded row's
// tenant. create: payload.tenantId, if set, must equal it. Anything else fails the write.
export type StreamTenantOption = { readonly streamTenantId?: TenantId | undefined };

// Why a framework system-user write may reach a locked row. Statutory deletion (retention)
// and Art. 17 erasure must succeed on locked rows; any other system write stays blocked.
export const WritePurposes = { retention: "retention", erasure: "erasure" } as const;
export type WritePurpose = (typeof WritePurposes)[keyof typeof WritePurposes];

// The executor refuses to update or delete a row that meets the entity's `lockedWhen`.
// Exempt: forget, a framework system user that names a `writePurpose`, and a call that
// sets `unsafeSkipLockGuard` (server code unlocking a row on purpose; applies to that one call).
export type LockGuardOption = {
  readonly unsafeSkipLockGuard?: boolean;
  readonly writePurpose?: WritePurpose;
};

export type EventStoreExecutor = {
  create: (
    payload: Record<string, unknown>,
    user: SessionUser,
    db: TenantDb,
    options?: StreamTenantOption & { preSave?: PreSaveRunner },
  ) => Promise<WriteResult<SaveContext>>;

  update: (
    payload: { id: EntityId; version?: number | undefined; changes: Record<string, unknown> },
    user: SessionUser,
    db: TenantDb,
    options?: StreamTenantOption &
      LockGuardOption & {
        skipOptimisticLock?: boolean;
        skipUnchanged?: boolean;
        // Server-code only (never forwarded by the generic update handler): also
        // update a soft-deleted row, e.g. to move it with its parent so a later
        // restore lands consistently. Tenant and ownership checks still apply;
        // the row stays deleted.
        includeDeleted?: boolean;
        preSave?: PreSaveRunner;
        // Declarative precondition for a "genau einmal"-transition:
        // field/value pairs the row must still hold at write
        // time — a `null` expected value matches a null field. Re-read fresh,
        // atomically with the write's stream version (not the payload's stale
        // `previous`), so a concurrent writer that already moved the row on is
        // caught even when it doesn't collide with the stream-version check.
        // Mismatch fails the whole update with PreconditionFailedError instead
        // of applying it.
        // Scalars only (string/number/boolean/null) — the check is `!==`, so an
        // object/Date/Instant value would compare by reference and silently
        // never match; a timestamp precondition needs its own scalar mirror
        // field to check against, not the compound value itself. Also plain
        // columns only: the check reads raw column values (no decrypt pass),
        // so a pii/encrypted field can't be used here.
        expect?: Readonly<Record<string, string | number | boolean | null>>;
      },
  ) => Promise<WriteResult<SaveContext>>;

  delete: (
    payload: { id: EntityId },
    user: SessionUser,
    db: TenantDb,
    options?: StreamTenantOption & LockGuardOption,
  ) => Promise<WriteResult<DeleteContext>>;

  // Hard-purge (Art. 17 erasure). Like delete, but emits `<entity>.forgotten`
  // which hard-deletes the row even for softDelete entities — and, being an
  // auto-verb replayed by the implicit projection, the erasure survives a
  // rebuild (created → forgotten → row gone). Reaches soft-deleted rows too.
  forget: (
    payload: { id: EntityId },
    user: SessionUser,
    db: TenantDb,
    options?: StreamTenantOption,
  ) => Promise<WriteResult<DeleteContext>>;

  restore: (
    payload: { id: EntityId },
    user: SessionUser,
    db: TenantDb,
    options?: StreamTenantOption,
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
            readonly op: "eq" | "ne" | "lt" | "gt" | "lte" | "gte" | "in";
            readonly value: unknown;
          }
        | undefined;
      // User-chosen faceted filters (dynamic, additive to the static
      // `filter`). All combined with AND.
      filters?:
        | ReadonlyArray<{
            readonly field: string;
            readonly op: "eq" | "ne" | "lt" | "gt" | "lte" | "gte" | "in";
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
      // fw#2660 — a text search also matches `searchable: true` reference
      // fields (and the implicit tenantId→tenant.name row-meta reference) by
      // their target row's labelField, not just the raw FK column. Only
      // available at request time (registry access), so it rides the same
      // runtime-override extension point as searchAdapter. `fields` and
      // `resolveEntity` travel together — one without the other silently
      // no-ops, so they're grouped instead of two independent optionals.
      readonly referenceSearch?: {
        readonly fields: ReadonlyArray<{
          readonly fieldName: string;
          readonly targetEntityName: string;
          readonly labelField: string;
        }>;
        readonly resolveEntity: (entityName: string) => EntityDefinition | undefined;
      };
      // fw#2741 — `sortable: true` reference fields order by the target row's
      // labelField instead of the raw FK column. Same request-time registry
      // dependency (and the same fields/resolveEntity pairing) as referenceSearch.
      readonly referenceSort?: {
        readonly fields: ReadonlyArray<{
          readonly fieldName: string;
          readonly targetEntityName: string;
          readonly labelField: string;
        }>;
        readonly resolveEntity: (entityName: string) => EntityDefinition | undefined;
      };
      // Join-row read-gate (EntityDefinition.parentRef) — same request-time
      // registry dependency as referenceSearch/referenceSort above.
      readonly parentVisibility?: ParentVisibilityOption;
    },
  ) => Promise<CursorResult<Record<string, unknown>>>;

  detail: (
    payload: { id: EntityId },
    user: SessionUser,
    db: TenantDb,
    options?: { readonly parentVisibility?: ParentVisibilityOption },
  ) => Promise<Record<string, unknown> | null>;
};
