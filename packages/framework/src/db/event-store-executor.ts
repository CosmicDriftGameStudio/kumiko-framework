import type { LocalKeyKmsAdapter } from "../crypto";
import type {
  DeleteContext,
  EntityDefinition,
  EntityId,
  SaveContext,
  SessionUser,
  WriteResult,
} from "../engine/types";
import type { EntityCache } from "../pipeline/entity-cache";
import type { SearchAdapter } from "../search/types";
import type { EnvelopeCipher } from "../secrets/envelope-cipher";
import { buildExecutorContext, type Table } from "./event-store-executor-context";
import { createReadVerbs } from "./event-store-executor-read";
import { createWriteVerbs } from "./event-store-executor-write";
import type { CursorResult } from "./index";

// The executor writes events + auto-projection (entity table) in one TX.
// It no longer knows about user projections — those are driven by the
// pipeline, which reads the StoredEvent surfaced on SaveContext/DeleteContext
// and iterates the registry itself. Executor-level `registry` options were
// removed to close the silent-bypass hole where a caller forgetting to pass
// one would skip projections without any signal.
//
// Split into three files (#1005, Welle 2): this facade holds the public
// types + the createEventStoreExecutor() factory. Context-building (crypto/
// ownership helpers shared by every verb) lives in
// event-store-executor-context.ts; the write verbs (create/update/delete/
// forget/restore) in event-store-executor-write.ts; the read verbs (list/
// detail) in event-store-executor-read.ts.

export type { EntityLifecycleVerb } from "./event-store-executor-context";
export { entityEventName } from "./event-store-executor-context";

export type EventStoreExecutorOptions = {
  searchAdapter?: SearchAdapter;
  entityName: string; // required — the aggregateType marker on every event
  entityCache?: EntityCache;
  /** Override the boot-injected cipher for fields marked `encrypted: true`. */
  encryption?: EnvelopeCipher;
  /** Override the boot-injected subject KMS for pii-annotated fields. */
  kms?: LocalKeyKmsAdapter;
};

export type EventStoreExecutor = {
  create: (
    payload: Record<string, unknown>,
    user: SessionUser,
    db: import("./tenant-db").TenantDb,
  ) => Promise<WriteResult<SaveContext>>;

  update: (
    payload: { id: EntityId; version?: number | undefined; changes: Record<string, unknown> },
    user: SessionUser,
    db: import("./tenant-db").TenantDb,
    options?: { skipOptimisticLock?: boolean },
  ) => Promise<WriteResult<SaveContext>>;

  delete: (
    payload: { id: EntityId },
    user: SessionUser,
    db: import("./tenant-db").TenantDb,
  ) => Promise<WriteResult<DeleteContext>>;

  // Hard-purge (Art. 17 erasure). Like delete, but emits `<entity>.forgotten`
  // which hard-deletes the row even for softDelete entities — and, being an
  // auto-verb replayed by the implicit projection, the erasure survives a
  // rebuild (created → forgotten → row gone). Reaches soft-deleted rows too.
  forget: (
    payload: { id: EntityId },
    user: SessionUser,
    db: import("./tenant-db").TenantDb,
  ) => Promise<WriteResult<DeleteContext>>;

  restore: (
    payload: { id: EntityId },
    user: SessionUser,
    db: import("./tenant-db").TenantDb,
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
      // User-gewählte Faceted-Filter (dynamisch, additiv zum statischen
      // `filter`). Alle werden mit AND verknüpft.
      filters?:
        | ReadonlyArray<{
            readonly field: string;
            readonly op: "eq" | "ne" | "lt" | "gt" | "in";
            readonly value: unknown;
          }>
        | undefined;
    },
    user: SessionUser,
    db: import("./tenant-db").TenantDb,
    /** Tier 2.7e Audit-Fix: per-Call SearchAdapter Override. Wenn der
     *  Executor beim Build keinen SearchAdapter via Options bekommen
     *  hat (defaultEntityQueryHandler-Pfad), kann der Caller (Handler)
     *  hier zur Runtime einen aus ctx.searchAdapter durchreichen.
     *  options.searchAdapter (build-time) gewinnt — runtime-Override
     *  ist Fallback für die default-Wrapper. */
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
    db: import("./tenant-db").TenantDb,
  ) => Promise<Record<string, unknown> | null>;
};

export function createEventStoreExecutor(
  table: Table,
  entity: EntityDefinition,
  options: EventStoreExecutorOptions,
): EventStoreExecutor {
  const ctx = buildExecutorContext(table, entity, options);
  return {
    ...createWriteVerbs(ctx),
    ...createReadVerbs(ctx),
  };
}
