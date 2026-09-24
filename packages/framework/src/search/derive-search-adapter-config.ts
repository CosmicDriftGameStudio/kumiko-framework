import type { Registry } from "../engine/types";
import type { SearchAdapterConfig } from "./types";

// Union of getSearchableFields() across every registered entity, in stable
// first-occurrence order and deduplicated. Feeds SearchAdapter.setDefaultConfig
// so the framework can hand the adapter a config derived purely from the
// registry, without any app-side wiring.
//
// searchPayloadExtension keys (e.g. customFields) are dynamic per-tenant and
// therefore not part of any entity's static searchableFields — they stay out
// of searchableAttributes here too. Not solved by this change, not worsened.
export function deriveSearchAdapterConfig(registry: Registry): SearchAdapterConfig | undefined {
  const searchableFields: string[] = [];
  const seen = new Set<string>();

  for (const entityName of registry.getAllEntities().keys()) {
    for (const field of registry.getSearchableFields(entityName)) {
      if (seen.has(field)) continue;
      seen.add(field);
      searchableFields.push(field);
    }
  }

  if (searchableFields.length === 0) return undefined;

  return { searchableFields, rankingFields: searchableFields };
}
