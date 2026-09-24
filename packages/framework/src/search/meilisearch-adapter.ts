import { type EnqueuedTaskPromise, ErrorStatusCode, Meilisearch, type Task } from "meilisearch";
import type { EntityId, TenantId } from "../engine/types/identifiers";
import type { SearchAdapter, SearchAdapterConfig, SearchResult } from "./types";

// meilisearch's waitTask() RESOLVES (never rejects) once the server task
// reaches a terminal state, even "failed" — a rejected doc (e.g. an id over
// Meili's 511-byte limit) otherwise fails silently and the caller thinks
// the write succeeded. Route every waitTask() through here so a non-
// "succeeded" status always throws, except for the error codes a caller
// declares as an already-reached end state.
async function awaitSucceededTask(
  enqueued: EnqueuedTaskPromise,
  toleratedErrorCodes: readonly string[] = [],
): Promise<Task> {
  const task = await enqueued.waitTask();
  const tolerated = task.error ? toleratedErrorCodes.includes(task.error.code) : false;
  if (task.status !== "succeeded" && !tolerated) {
    const detail = task.error ? `${task.error.code}: ${task.error.message}` : "no error detail";
    throw new Error(
      `Meilisearch task ${task.uid} (${task.type}) ended with status "${task.status}": ${detail}`,
    );
  }
  return task;
}

// A tenant whose index was never created (no default config, nothing ever
// indexed) has nothing to delete: the remove's end state already holds.
// Without this, a delete event or a DSGVO subject purge for such a tenant
// would fail forever.
const REMOVE_TOLERATED_ERROR_CODES: readonly string[] = [ErrorStatusCode.INDEX_NOT_FOUND];

export type MeilisearchAdapterOptions = {
  url: string;
  apiKey: string;
  indexPrefix?: string;
};

// Exported for unit tests (index-name / primary-key shape) without a live Meili.
export function meilisearchTenantIndex(prefix: string, tenantId: TenantId): string {
  return `${prefix}t${tenantId}`;
}

// Meilisearch primary-key-ids: alphanumerics, `-`, `_`. UUIDs contain `-` —
// legal. Replace anything else just in case callers pass unexpected shapes.
export function meilisearchDocId(entityType: string, entityId: EntityId): string {
  return `${entityType}_${String(entityId).replace(/[^0-9A-Za-z_-]/g, "_")}`;
}

export function createMeilisearchAdapter(options: MeilisearchAdapterOptions): SearchAdapter {
  const client = new Meilisearch({ host: options.url, apiKey: options.apiKey });
  const prefix = options.indexPrefix ?? "kumiko_";

  // Set via setDefaultConfig once the registry is known (server.ts boot).
  // undefined until then — tenants stay unconfigured, matching prior behavior.
  let defaultConfig: SearchAdapterConfig | undefined;
  // Per-tenant configure state. An explicit `configure(tenantId, ...)` call
  // always wins and is never overwritten by the lazy default — its promise
  // sits in the map exactly like a lazily-triggered one.
  const configuredTenants = new Map<TenantId, Promise<void>>();

  async function applyConfig(tenantId: TenantId, config: SearchAdapterConfig): Promise<void> {
    const index = client.index(meilisearchTenantIndex(prefix, tenantId));
    const fields = config.rankingFields ?? config.searchableFields;
    await awaitSucceededTask(index.updateSearchableAttributes([...fields]));
    await awaitSucceededTask(index.updateFilterableAttributes(["_type", "_weight"]));
    await awaitSucceededTask(index.updateSortableAttributes(["_weight"]));
  }

  // Lazily configures a tenant's index off the default config on its first
  // access, so callers that never call `configure` still get a filterable/
  // sortable index instead of failing with "not filterable"/"index not
  // found". A failed configure is never memoized — remove the map entry (iff
  // it's still the same in-flight promise) and rethrow, so a transient
  // Meili outage doesn't permanently poison the tenant for the process.
  async function ensureConfigured(tenantId: TenantId): Promise<void> {
    // skip: no registry-derived default — callers configure tenants explicitly.
    if (!defaultConfig) return;
    const existing = configuredTenants.get(tenantId);
    if (existing) {
      await existing;
      // skip: configured (or in flight) already for this tenant.
      return;
    }
    await trackConfigure(tenantId, defaultConfig);
  }

  async function trackConfigure(tenantId: TenantId, config: SearchAdapterConfig): Promise<void> {
    const pending = applyConfig(tenantId, config);
    configuredTenants.set(tenantId, pending);
    try {
      await pending;
    } catch (err) {
      if (configuredTenants.get(tenantId) === pending) {
        configuredTenants.delete(tenantId);
      }
      throw err;
    }
  }

  return {
    setDefaultConfig(config) {
      defaultConfig = config;
    },

    async configure(tenantId, config) {
      await trackConfigure(tenantId, config);
    },

    async index(tenantId, doc) {
      await ensureConfigured(tenantId);
      const index = client.index(meilisearchTenantIndex(prefix, tenantId));
      await awaitSucceededTask(
        index.addDocuments(
          [
            {
              _id: meilisearchDocId(doc.entityType, doc.entityId),
              _type: doc.entityType,
              _weight: doc.weight,
              _entityId: doc.entityId,
              ...doc.fields,
            },
          ],
          { primaryKey: "_id" },
        ),
      );
    },

    async indexBatch(tenantId, docs) {
      // skip: empty batch — avoid an unnecessary Meilisearch round-trip
      if (docs.length === 0) return;
      await ensureConfigured(tenantId);
      const index = client.index(meilisearchTenantIndex(prefix, tenantId));
      const payload = docs.map((doc) => ({
        _id: meilisearchDocId(doc.entityType, doc.entityId),
        _type: doc.entityType,
        _weight: doc.weight,
        _entityId: doc.entityId,
        ...doc.fields,
      }));
      // Single Meilisearch task covering all N docs. Meilisearch processes
      // the payload server-side as one indexing job — waitTask blocks until
      // that job is done, but it's one round-trip instead of N.
      await awaitSucceededTask(index.addDocuments(payload, { primaryKey: "_id" }));
    },

    async removeBatch(tenantId, items) {
      // skip: empty batch — avoid an unnecessary Meilisearch round-trip
      if (items.length === 0) return;
      await ensureConfigured(tenantId);
      const index = client.index(meilisearchTenantIndex(prefix, tenantId));
      const ids = items.map((i) => meilisearchDocId(i.entityType, i.entityId));
      await awaitSucceededTask(index.deleteDocuments(ids), REMOVE_TOLERATED_ERROR_CODES);
    },

    async search(tenantId, query, options) {
      await ensureConfigured(tenantId);
      const index = client.index(meilisearchTenantIndex(prefix, tenantId));

      const filter: string[] = [];
      if (options?.filterType) {
        filter.push(`_type = "${options.filterType}"`);
      }

      const searchParams: Record<string, unknown> = {
        limit: options?.limit ?? 50,
        sort: ["_weight:desc"],
      };
      if (filter.length > 0) searchParams["filter"] = filter;

      const results = await index.search(query, searchParams);

      return results.hits.map(
        (hit: Record<string, unknown>): SearchResult => ({
          entityType: hit["_type"] as string, // @cast-boundary engine-bridge
          entityId: hit["_entityId"] as EntityId, // @cast-boundary engine-bridge
        }),
      );
    },

    async remove(tenantId, entityType, entityId) {
      await ensureConfigured(tenantId);
      const index = client.index(meilisearchTenantIndex(prefix, tenantId));
      await awaitSucceededTask(
        index.deleteDocument(meilisearchDocId(entityType, entityId)),
        REMOVE_TOLERATED_ERROR_CODES,
      );
    },
  };
}
