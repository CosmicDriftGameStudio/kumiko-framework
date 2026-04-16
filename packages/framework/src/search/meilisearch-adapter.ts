import { Meilisearch } from "meilisearch";
import type { SearchAdapter, SearchResult } from "./types";

export type MeilisearchAdapterOptions = {
  url: string;
  apiKey: string;
  indexPrefix?: string;
};

function tenantIndex(prefix: string, tenantId: number): string {
  return `${prefix}t${tenantId}`;
}

function docId(entityType: string, entityId: number): string {
  return `${entityType}_${entityId}`;
}

export function createMeilisearchAdapter(options: MeilisearchAdapterOptions): SearchAdapter {
  const client = new Meilisearch({ host: options.url, apiKey: options.apiKey });
  const prefix = options.indexPrefix ?? "kumiko_";

  return {
    async configure(tenantId, config) {
      const index = client.index(tenantIndex(prefix, tenantId));
      const fields = config.rankingFields ?? config.searchableFields;
      await index.updateSearchableAttributes([...fields]).waitTask();
      await index.updateFilterableAttributes(["_type", "_weight"]).waitTask();
      await index.updateSortableAttributes(["_weight"]).waitTask();
    },

    async index(tenantId, doc) {
      const index = client.index(tenantIndex(prefix, tenantId));
      await index
        .addDocuments(
          [
            {
              _id: docId(doc.entityType, doc.entityId),
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
      const index = client.index(tenantIndex(prefix, tenantId));
      const payload = docs.map((doc) => ({
        _id: docId(doc.entityType, doc.entityId),
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
      const index = client.index(tenantIndex(prefix, tenantId));
      const ids = items.map((i) => docId(i.entityType, i.entityId));
      await index.deleteDocuments(ids).waitTask();
    },

    async search(tenantId, query, options) {
      const index = client.index(tenantIndex(prefix, tenantId));

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
          entityType: hit["_type"] as string,
          entityId: hit["_entityId"] as number,
        }),
      );
    },

    async remove(tenantId, entityType, entityId) {
      const index = client.index(tenantIndex(prefix, tenantId));
      await index.deleteDocument(docId(entityType, entityId)).waitTask();
    },
  };
}
