import type { EntityId, TenantId } from "../engine/types/identifiers.ts";

export type MeilisearchAdapterOptions = {
  url: string;
  apiKey: string;
  indexPrefix?: string;
};

export const MEILI_INDEX_PREFIX_ENV = "KUMIKO_MEILI_INDEX_PREFIX";

// The env beats the option so an e2e run isolates its server without the app passing anything.
export function resolveMeilisearchIndexPrefix(
  indexPrefix: string | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return env[MEILI_INDEX_PREFIX_ENV] || (indexPrefix ?? "kumiko_");
}

// Exported for unit tests (index-name / primary-key shape) without a live Meili.
export function meilisearchTenantIndex(prefix: string, tenantId: TenantId): string {
  return `${prefix}t${tenantId}`;
}

// Meilisearch primary-key-ids: alphanumerics, `-`, `_`. UUIDs contain `-` —
// legal. Replace anything else just in case callers pass unexpected shapes.
export function meilisearchDocId(entityType: string, entityId: EntityId): string {
  return `${entityType}_${String(entityId).replace(/[^0-9A-Za-z_-]/g, "_")}`;
}
