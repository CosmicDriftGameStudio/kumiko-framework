import { createHash } from "node:crypto";
import { resolveBaseDbAndSearchAdapter } from "@cosmicdrift/kumiko-framework/api";
import {
  type DbConnection,
  fetchOne,
  insertOne,
  listEventTenantIds,
  tryWithSessionAdvisoryLock,
} from "@cosmicdrift/kumiko-framework/db";
import type { Registry } from "@cosmicdrift/kumiko-framework/engine";
import { createEsOperationsTable, esOperationsTable } from "@cosmicdrift/kumiko-framework/es-ops";
import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";
import { reindexEntity, type SearchAdapter } from "@cosmicdrift/kumiko-framework/search";

export const SKIP_SEARCH_REINDEX_ENV = "KUMIKO_SKIP_SEARCH_REINDEX";

// Bump when the way documents are built or stored in the index changes (2: long fields are
// split into pieces), so every searchable entity is indexed again once.
export const SEARCH_DOCUMENT_FORMAT_VERSION = 2;

export const SEARCH_REINDEX_LOCK_KEY = 0x73_72_63_68; // 'srch'

type Log = ReturnType<typeof createFallbackLogger>;

export type SearchReindexOutcome = {
  /** A peer holds the lock and does the work. */
  readonly skippedBecauseLocked: boolean;
  readonly reindexedEntities: readonly string[];
  readonly failedEntities: readonly string[];
};

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function searchedEntityNames(registry: Registry): string[] {
  return [...registry.getAllEntities().keys()].filter(
    (name) =>
      registry.getSearchableFields(name).length > 0 ||
      registry.getSearchPayloadExtensions(name).length > 0,
  );
}

/** Changes when the search fields of the entity or the document format change. */
export function searchReindexFingerprint(registry: Registry, entityName: string): string {
  const fields = [...registry.getSearchableFields(entityName)].sort();
  const extensionCount = registry.getSearchPayloadExtensions(entityName).length;
  return createHash("sha256")
    .update(`${SEARCH_DOCUMENT_FORMAT_VERSION}|${fields.join(",")}|${extensionCount}`)
    .digest("hex")
    .slice(0, 16);
}

// The completion marker is a row in kumiko_es_operations, keyed by entity and fingerprint: a
// changed fingerprint is a missing marker, and the row is only written after a clean run.
function markerId(entityName: string, fingerprint: string): string {
  return `search-reindex:${entityName}:${fingerprint}`;
}

async function hasMarker(db: DbConnection, id: string): Promise<boolean> {
  return (await fetchOne(db, esOperationsTable, { id })) !== undefined;
}

async function pendingEntities(db: DbConnection, registry: Registry): Promise<string[]> {
  const pending: string[] = [];
  for (const name of searchedEntityNames(registry)) {
    if (!(await hasMarker(db, markerId(name, searchReindexFingerprint(registry, name))))) {
      pending.push(name);
    }
  }
  return pending;
}

export async function runSearchReindexOnBoot(opts: {
  readonly db: DbConnection;
  readonly registry: Registry;
  readonly searchAdapter: SearchAdapter;
  readonly signal?: AbortSignal;
  readonly log?: Log;
}): Promise<SearchReindexOutcome> {
  const { db, registry, searchAdapter, signal } = opts;
  const log = opts.log ?? createFallbackLogger("search-reindex");
  await createEsOperationsTable(db);
  // Cheap exit for the common boot, without taking the lock.
  if ((await pendingEntities(db, registry)).length === 0) {
    return { skippedBecauseLocked: false, reindexedEntities: [], failedEntities: [] };
  }

  const locked = await tryWithSessionAdvisoryLock(db, SEARCH_REINDEX_LOCK_KEY, async () => {
    // A peer may have finished between the check above and the lock.
    const pending = await pendingEntities(db, registry);
    const tenantIds = pending.length > 0 ? await listEventTenantIds(db) : [];
    const reindexed: string[] = [];
    const failed: string[] = [];
    for (const entityName of pending) {
      if (isAborted(signal)) break;
      let clean = true;
      for (const tenantId of tenantIds) {
        if (isAborted(signal)) {
          clean = false;
          break;
        }
        try {
          const result = await reindexEntity(db, registry, searchAdapter, entityName, tenantId);
          if (result.failures.length > 0) {
            clean = false;
            log.error("search reindex had failing rows; it is retried on the next boot", {
              entityName,
              tenantId,
              failures: result.failures.length,
              firstReason: result.failures[0]?.reason,
            });
          }
        } catch (e) {
          clean = false;
          log.error("search reindex failed; it is retried on the next boot", {
            entityName,
            tenantId,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
      if (!clean) {
        failed.push(entityName);
        continue;
      }
      await insertOne(db, esOperationsTable, {
        id: markerId(entityName, searchReindexFingerprint(registry, entityName)),
        operationType: "search-reindex",
        durationMs: 0,
        appliedBy: "boot",
      });
      reindexed.push(entityName);
    }
    return { reindexed, failed };
  });

  if (!locked.acquired) {
    return { skippedBecauseLocked: true, reindexedEntities: [], failedEntities: [] };
  }
  return {
    skippedBecauseLocked: false,
    reindexedEntities: locked.value.reindexed,
    failedEntities: locked.value.failed,
  };
}

type ShutdownRegistry = {
  registerShutdownHook(name: string, fn: () => Promise<void>): void;
};

// Background like the PII backfill: a reindex scales with the data and must not delay readiness.
export function startSearchReindexOnBoot(opts: {
  readonly db: DbConnection;
  readonly registry: Registry;
  readonly extraContext: object;
  readonly lifecycle: ShutdownRegistry;
  readonly envSource: Readonly<Record<string, string | undefined>>;
}): void {
  const { searchAdapter } = resolveBaseDbAndSearchAdapter(opts.extraContext, opts.registry);
  // skip: no search backend in this process, or the operator opted out
  if (searchAdapter === undefined || opts.envSource[SKIP_SEARCH_REINDEX_ENV] === "1") return;

  const log = createFallbackLogger("search-reindex");
  const abortController = new AbortController();
  const run = runSearchReindexOnBoot({
    db: opts.db,
    registry: opts.registry,
    searchAdapter,
    signal: abortController.signal,
    log,
  }).then(
    (outcome) => {
      if (outcome.reindexedEntities.length > 0) {
        log.info("search reindex finished", { entities: outcome.reindexedEntities });
      }
    },
    (e: unknown) => {
      log.error("search reindex crashed; it is retried on the next boot", {
        error: e instanceof Error ? e.message : String(e),
      });
    },
  );

  opts.lifecycle.registerShutdownHook("searchReindex", async () => {
    abortController.abort();
    await run;
  });
}
