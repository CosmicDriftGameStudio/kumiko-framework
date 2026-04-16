// Domain-identifier type aliases. Used everywhere a tenantId/userId/aggregateId
// travels through the framework. One declaration per concept so future
// representation changes (branded types, UUID validation, opaque wrappers)
// land in a single place.

// Tenant identifier — UUID string today. May become branded/opaque later
// without touching call sites.
export type TenantId = string;

// Zero-UUID acts as the "system-scope" marker: system handlers carry this
// tenantId when the event doesn't belong to any particular tenant (reference
// data, cross-tenant jobs, global config). Central constant so callers don't
// re-type the UUID string and the isSystemTenant() check stays in sync.
export const ZERO_TENANT_ID: TenantId = "00000000-0000-4000-8000-000000000000";

export function isSystemTenant(tenantId: TenantId | null | undefined): boolean {
  return !tenantId || tenantId === ZERO_TENANT_ID;
}

// Primary-key identifier for any entity row. Two shapes coexist because of
// the entity-def `idType` switch: classic CRUD entities keep `serial` (number),
// while tenant + ES aggregates run on `uuid` (string). Call sites that pass
// the id through to the DB layer stay agnostic; only code that formats ids
// for URLs, logs, or cache keys needs `String(id)` — JS coerces both safely.
export type EntityId = number | string;
