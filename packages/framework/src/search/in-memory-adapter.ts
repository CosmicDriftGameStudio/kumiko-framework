import type { SearchAdapter } from "./types";

type IndexEntry = {
  id: number;
  fields: Record<string, string>;
};

type EntityConfig = {
  searchableFields: readonly string[];
  rankingFields: readonly string[];
};

export function createInMemorySearchAdapter(): SearchAdapter {
  const indices = new Map<string, Map<number, IndexEntry>>();
  const configs = new Map<string, EntityConfig>();

  function getOrCreateIndex(entity: string): Map<number, IndexEntry> {
    let index = indices.get(entity);
    if (!index) {
      index = new Map();
      indices.set(entity, index);
    }
    return index;
  }

  function getConfig(entity: string): EntityConfig {
    return configs.get(entity) ?? { searchableFields: [], rankingFields: [] };
  }

  return {
    async configure(entity, config) {
      configs.set(entity, {
        searchableFields: config.searchableFields,
        rankingFields: config.rankingFields ?? config.searchableFields,
      });
    },

    async index(entity, id, fields) {
      const stringFields: Record<string, string> = {};
      for (const [key, value] of Object.entries(fields)) {
        if (value !== null && value !== undefined) {
          stringFields[key] = String(value).toLowerCase();
        }
      }
      getOrCreateIndex(entity).set(id, { id, fields: stringFields });
    },

    async search(entity, query, options) {
      const index = indices.get(entity);
      if (!index) return [];

      const q = query.toLowerCase();
      const limit = options?.limit ?? 50;
      const config = getConfig(entity);
      const rankingFields = config.rankingFields.length > 0 ? config.rankingFields : null;

      const scored: Array<{ id: number; score: number }> = [];

      for (const entry of index.values()) {
        let score = 0;
        const fieldsToSearch =
          config.searchableFields.length > 0 ? config.searchableFields : Object.keys(entry.fields);

        for (let i = 0; i < fieldsToSearch.length; i++) {
          const fieldName = fieldsToSearch[i]!;
          const value = entry.fields[fieldName];
          if (!value) continue;

          if (value.includes(q)) {
            // Field ranking: earlier in rankingFields = much higher weight
            const rankIndex = rankingFields?.indexOf(fieldName) ?? -1;
            const fieldWeight = rankIndex >= 0 && rankingFields ? (rankingFields.length - rankIndex) * 1000 : 1;

            // Match quality bonuses (secondary to field ranking)
            const exactBonus = value === q ? 100 : 0;
            const prefixBonus = value.startsWith(q) ? 50 : 0;

            score += fieldWeight + exactBonus + prefixBonus;
          }
        }

        if (score > 0) {
          scored.push({ id: entry.id, score });
        }
      }

      // Sort by score descending
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, limit).map((s) => s.id);
    },

    async remove(entity, id) {
      indices.get(entity)?.delete(id);
    },
  };
}
