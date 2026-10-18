export const HOST_ROUTING_FEATURE = "host-routing";

export const HostRoutingQueries = {
  tenantKeyExists: `${HOST_ROUTING_FEATURE}:query:tenant-key-exists`,
} as const;

// One DNS label: what a subdomain or a path segment may hold before any DB
// lookup happens. The length cap matches the tenant key column's practical
// size and keeps lookups for absurd keys out of the database.
export const TENANT_KEY_MAX_LENGTH = 50;
export const TENANT_KEY_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;

export function isTenantKeyCandidate(value: string): boolean {
  return value.length <= TENANT_KEY_MAX_LENGTH && TENANT_KEY_PATTERN.test(value);
}
