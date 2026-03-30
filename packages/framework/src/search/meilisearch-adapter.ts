import { MeiliSearch } from "meilisearch";
import type { SearchAdapter } from "./types";

export type MeilisearchAdapterOptions = {
  url: string;
  apiKey: string;
};

export function createMeilisearchAdapter(options: MeilisearchAdapterOptions): SearchAdapter {
  const client = new MeiliSearch({ host: options.url, apiKey: options.apiKey });

  return {
    async configure(entity, config) {
      const index = client.index(entity);
      // Fields listed first have higher search relevance in Meilisearch
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

    async remove(entity, id) {
      await client.index(entity).deleteDocument(id).waitTask();
    },
  };
}
