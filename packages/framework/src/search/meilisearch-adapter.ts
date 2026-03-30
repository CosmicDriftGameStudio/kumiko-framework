import { MeiliSearch } from "meilisearch";
import type { GlobalSearchResult, SearchAdapter } from "./types";

export type MeilisearchAdapterOptions = {
  url: string;
  apiKey: string;
};

export function createMeilisearchAdapter(options: MeilisearchAdapterOptions): SearchAdapter {
  const client = new MeiliSearch({ host: options.url, apiKey: options.apiKey });

  return {
    async configure(entity, config) {
      const index = client.index(entity);
      const fields = config.rankingFields ?? config.searchableFields;
      await index.updateSearchableAttributes([...fields]).waitTask();
    },

    async index(entity, id, fields) {
      await client
        .index(entity)
        .addDocuments([{ id, ...fields }], { primaryKey: "id" })
        .waitTask();
    },

    async search(entity, query, options) {
      const results = await client.index(entity).search(query, {
        limit: options?.limit ?? 50,
      });
      return results.hits.map((hit) => hit["id"] as number);
    },

    async globalSearch(query, entities, options) {
      const limit = options?.limit ?? 10;
      const queries = entities.map((entity) => ({
        indexUid: entity,
        q: query,
        limit,
      }));

      const multiResult = await client.multiSearch({ queries });
      const results: GlobalSearchResult[] = [];

      for (const result of multiResult.results) {
        const ids = result.hits.map((hit) => hit["id"] as number);
        if (ids.length > 0) {
          results.push({ entity: result.indexUid, ids });
        }
      }

      return results;
    },

    async remove(entity, id) {
      await client.index(entity).deleteDocument(id).waitTask();
    },
  };
}
