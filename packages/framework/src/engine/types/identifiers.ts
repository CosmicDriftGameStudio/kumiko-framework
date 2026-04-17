// Domain-identifier type aliases. Used everywhere a tenantId/userId/aggregateId
// travels through the framework. One declaration per concept so future
// representation changes (branded types, UUID validation, opaque wrappers)
// land in a single place.

// Tenant identifier — UUID string today. May become branded/opaque later
// without touching call sites.
export type TenantId = string;

// "System-scope" tenant marker: handlers carry this tenantId when the event
// doesn't belong to any particular tenant (reference data, cross-tenant
// jobs, global config). The concrete UUID is a valid v4 (not all-zeroes —
// Postgres' UUID type rejects invalid variants), chosen to be easy to
// eyeball in logs. Central constant so call sites don't re-type the string
// and the isSystemTenant() check stays in sync.
export const SYSTEM_TENANT_ID: TenantId = "00000000-0000-4000-8000-000000000000";

export function isSystemTenant(tenantId: TenantId | null | undefined): boolean {
  return !tenantId || tenantId === SYSTEM_TENANT_ID;
}

// Primary-key identifier for any entity row. Two shapes coexist because of
// the entity-def `idType` switch: classic CRUD entities keep `serial` (number),
// while tenant + ES aggregates run on `uuid` (string). Call sites that pass
// the id through to the DB layer stay agnostic; only code that formats ids
// for URLs, logs, or cache keys needs `String(id)` — JS coerces both safely.
export type EntityId = number | string;
