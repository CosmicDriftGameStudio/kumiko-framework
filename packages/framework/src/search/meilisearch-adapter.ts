import { Meilisearch } from "meilisearch";
import type { EntityId, TenantId } from "../engine/types/identifiers";
import type { SearchAdapter, SearchAdapterConfig, SearchResult } from "./types";

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
    await index.updateSearchableAttributes([...fields]).waitTask();
    await index.updateFilterableAttributes(["_type", "_weight"]).waitTask();
    await index.updateSortableAttributes(["_weight"]).waitTask();
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
      await index
        .addDocuments(
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
        )
        .waitTask();
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
      await index.addDocuments(payload, { primaryKey: "_id" }).waitTask();
    },

    async removeBatch(tenantId, items) {
      // skip: empty batch — avoid an unnecessary Meilisearch round-trip
      if (items.length === 0) return;
      await ensureConfigured(tenantId);
      const index = client.index(meilisearchTenantIndex(prefix, tenantId));
      const ids = items.map((i) => meilisearchDocId(i.entityType, i.entityId));
      await index.deleteDocuments(ids).waitTask();
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
      await index.deleteDocument(meilisearchDocId(entityType, entityId)).waitTask();
    },
  };
}
