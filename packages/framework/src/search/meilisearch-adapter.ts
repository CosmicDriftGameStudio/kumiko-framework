import { MeiliSearch } from "meilisearch";
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
  const client = new MeiliSearch({ host: options.url, apiKey: options.apiKey });
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
        (hit): SearchResult => ({
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
