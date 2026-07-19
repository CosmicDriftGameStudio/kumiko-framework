import { Meilisearch } from "meilisearch";
import type { EntityId, TenantId } from "../engine/types/identifiers";
import type { SearchAdapter, SearchResult } from "./types";

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

  return {
    async configure(tenantId, config) {
      const index = client.index(meilisearchTenantIndex(prefix, tenantId));
      const fields = config.rankingFields ?? config.searchableFields;
      await index.updateSearchableAttributes([...fields]).waitTask();
      await index.updateFilterableAttributes(["_type", "_weight"]).waitTask();
      await index.updateSortableAttributes(["_weight"]).waitTask();
    },

    async index(tenantId, doc) {
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
      const index = client.index(meilisearchTenantIndex(prefix, tenantId));
      const ids = items.map((i) => meilisearchDocId(i.entityType, i.entityId));
      await index.deleteDocuments(ids).waitTask();
    },

    async search(tenantId, query, options) {
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
      const index = client.index(meilisearchTenantIndex(prefix, tenantId));
      await index.deleteDocument(meilisearchDocId(entityType, entityId)).waitTask();
    },
  };
}
