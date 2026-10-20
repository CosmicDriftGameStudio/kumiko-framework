import type { Registry, TenantId } from "../engine/types/index.ts";
import { deriveSearchAdapterConfig } from "./derive-search-adapter-config.ts";
import type { SearchAdapter } from "./types.ts";

export function collectSearchableFieldNames(registry: Registry): readonly string[] {
  return deriveSearchAdapterConfig(registry)?.searchableFields ?? [];
}

export async function configureTenantSearchIndex(
  searchAdapter: SearchAdapter,
  registry: Registry,
  tenantId: TenantId,
): Promise<void> {
  const fields = collectSearchableFieldNames(registry);
  await searchAdapter.configure(tenantId, { searchableFields: fields, rankingFields: fields });
}
