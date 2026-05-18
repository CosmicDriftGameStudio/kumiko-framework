// @runtime client
// Domain-identifier type aliases. Used everywhere a tenantId/userId/aggregateId
// travels through the framework. One declaration per concept so future
// representation changes (branded types, UUID validation, opaque wrappers)
// land in a single place.

// Tenant identifier — UUID string today. May become branded/opaque later
// without touching call sites.
export type TenantId = string;

// Lowercase UUID (any RFC-4122 variant). Strict enough to keep client-
// supplied junk (e.g. SQL fragments, path-traversal probes) out of the
// pipeline; loose enough that v4 / v7 / nil all match. Any caller that
// already holds a TenantId from a trusted source (JWT payload, server
// config) skips this — the helper is for **untrusted input** crossing
// the system boundary.
const TENANT_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Validates a candidate string against the tenantId format and returns it
// as a TenantId, or `null` when it doesn't match. Use at every system
// boundary that admits untrusted input (HTTP headers, cookies, query
// params). Returning null instead of throwing keeps the caller in charge
// of the rejection shape — middleware returns 400, batch jobs may filter
// + log, and unit tests don't need a try/catch.
export function parseTenantId(value: unknown): TenantId | null {
  if (typeof value !== "string") return null;
  if (!TENANT_ID_REGEX.test(value)) return null;
  return value;
}

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
