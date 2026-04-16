import type { SearchAdapter, SearchAdapterConfig, SearchResult } from "./types";

type StoredDoc = {
  entityType: string;
  entityId: number;
  weight: number;
  text: Record<string, string>;
};

type TenantIndex = {
  config: SearchAdapterConfig;
  docs: Map<string, StoredDoc>;
};

function docKey(entityType: string, entityId: number): string {
  return `${entityType}:${entityId}`;
}

export function createInMemorySearchAdapter(): SearchAdapter {
  const tenants = new Map<number, TenantIndex>();

  function getTenant(tenantId: number): TenantIndex {
    let tenant = tenants.get(tenantId);
    if (!tenant) {
      tenant = { config: { searchableFields: [] }, docs: new Map() };
      tenants.set(tenantId, tenant);
    }
    return tenant;
  }

  return {
    async configure(tenantId, config) {
      const tenant = getTenant(tenantId);
      tenant.config = config;
    },

    async index(tenantId, doc) {
      const tenant = getTenant(tenantId);
      const text: Record<string, string> = {};

      for (const [key, value] of Object.entries(doc.fields)) {
        if (value !== null && value !== undefined) {
          text[key] = String(value).toLowerCase();
        }
      }

      tenant.docs.set(docKey(doc.entityType, doc.entityId), {
        entityType: doc.entityType,
        entityId: doc.entityId,
        weight: doc.weight,
        text,
      });
    },

    async search(tenantId, query, options) {
      const tenant = tenants.get(tenantId);
      if (!tenant) return [];

      const q = query.toLowerCase();
      const limit = options?.limit ?? 50;
      const filterType = options?.filterType;
      const rankingFields = tenant.config.rankingFields ?? tenant.config.searchableFields;

      const scored: Array<{ result: SearchResult; score: number }> = [];

      for (const doc of tenant.docs.values()) {
        if (filterType && doc.entityType !== filterType) continue;

        let matchScore = 0;
        const fieldsToSearch =
          tenant.config.searchableFields.length > 0
            ? [...tenant.config.searchableFields]
            : Object.keys(doc.text);

        for (const fieldName of fieldsToSearch) {
          const value = doc.text[fieldName];
          if (!value?.includes(q)) continue;

          // Field ranking: earlier in ranking = higher weight
          const rankIndex = rankingFields.indexOf(fieldName);
          const fieldWeight = rankIndex >= 0 ? (rankingFields.length - rankIndex) * 100 : 1;

          const exactBonus = value === q ? 50 : 0;
          const prefixBonus = value.startsWith(q) ? 25 : 0;

          matchScore += fieldWeight + exactBonus + prefixBonus;
        }

        if (matchScore > 0) {
          // Entity weight multiplier from searchWeight
          const totalScore = matchScore * doc.weight;
          scored.push({
            result: { entityType: doc.entityType, entityId: doc.entityId },
            score: totalScore,
          });
        }
      }

      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, limit).map((s) => s.result);
    },

    async remove(tenantId, entityType, entityId) {
      tenants.get(tenantId)?.docs.delete(docKey(entityType, entityId));
    },

    async indexBatch(tenantId, docs) {
      for (const doc of docs) {
        await this.index(tenantId, doc);
      }
    },

    async removeBatch(tenantId, items) {
      const tenant = tenants.get(tenantId);
      // skip: tenant has no in-memory index (never configured) — nothing to remove
      if (!tenant) return;
      for (const item of items) {
        tenant.docs.delete(docKey(item.entityType, item.entityId));
      }
    },
  };
}
