import { MeiliSearch } from "meilisearch";
import type { SearchAdapter } from "./types";

export type MeilisearchAdapterOptions = {
  url: string;
  apiKey: string;
};

export function createMeilisearchAdapter(options: MeilisearchAdapterOptions): SearchAdapter {
  const client = new MeiliSearch({ host: options.url, apiKey: options.apiKey });

  return {
    async index(entity, id, fields) {
      await client
        .index(entity)
        .addDocuments([{ id, ...fields }], { primaryKey: "id" })
        .waitTask();
    },

    async search(entity, query) {
      const results = await client.index(entity).search(query);
      return results.hits.map((hit) => hit["id"] as number);
    },

    async remove(entity, id) {
      await client.index(entity).deleteDocument(id).waitTask();
    },
  };
}
