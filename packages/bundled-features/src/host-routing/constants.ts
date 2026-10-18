export const HOST_ROUTING_FEATURE = "host-routing";

export const HostRoutingQueries = {
  tenantKeyExists: `${HOST_ROUTING_FEATURE}:query:tenant-key-exists`,
} as const;

// Matches tenant:write:create's key limit; keeps lookups for absurd keys out
// of the database.
export const TENANT_KEY_MAX_LENGTH = 50;
// A subdomain is one lowercase DNS label, so tenant keys outside this shape
// are only reachable in path mode.
export const TENANT_KEY_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;

export function isTenantKeyCandidate(value: string): boolean {
  return value.length <= TENANT_KEY_MAX_LENGTH && TENANT_KEY_PATTERN.test(value);
}

// Path mode takes any key made of unreserved URL characters, since the tenant
// feature itself only limits the length.
const PATH_TENANT_KEY_PATTERN = /^[A-Za-z0-9._~-]+$/;

export function isPathTenantKeyCandidate(value: string): boolean {
  return value.length <= TENANT_KEY_MAX_LENGTH && PATH_TENANT_KEY_PATTERN.test(value);
}
