import type { SearchAdapter } from "./types";

type IndexEntry = {
  id: number;
  text: string;
};

export function createInMemorySearchAdapter(): SearchAdapter {
  const indices = new Map<string, Map<number, IndexEntry>>();

  function getOrCreateIndex(entity: string): Map<number, IndexEntry> {
    let index = indices.get(entity);
    if (!index) {
      index = new Map();
      indices.set(entity, index);
    }
    return index;
  }

  return {
    async index(entity, id, fields) {
      const text = Object.values(fields)
        .filter((v): v is string => typeof v === "string")
        .join(" ")
        .toLowerCase();

      getOrCreateIndex(entity).set(id, { id, text });
    },

    async search(entity, query) {
      const index = indices.get(entity);
      if (!index) return [];

      const q = query.toLowerCase();
      const results: number[] = [];

      for (const entry of index.values()) {
        if (entry.text.includes(q)) {
          results.push(entry.id);
        }
      }

      return results;
    },

    async remove(entity, id) {
      indices.get(entity)?.delete(id);
    },
  };
}
