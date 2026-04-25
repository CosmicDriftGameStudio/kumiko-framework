// Subdomain-based tenantResolver + tenantExists wired against an LRU cache.
// Apps drop this into anonymousAccess: { tenantResolver, tenantExists, … }.
//
// Cache strategy: 5-minute TTL is the sweet spot — it absorbs traffic
// bursts (a Reddit hug peaks for ~10 minutes; cache means one DB lookup
// for the entire wave) without holding stale data so long that a freshly
// disabled tenant keeps serving content. Apps with stricter SLA can drop
// the TTL or call invalidateTenantCache(slug) from their disable-tenant
// handler.

import type { TenantId } from "@kumiko/framework/engine";

export type TenantLookup = (subdomain: string) => Promise<TenantId | null>;
export type TenantExistsLookup = (tenantId: TenantId) => Promise<boolean>;

export type SubdomainResolverOptions = {
  // Subdomain → tenantId. Typically queries the tenants table for an
  // active row matching the slug (acme.shop.com → "acme"). Returning null
  // is the legitimate "no such tenant" answer — throw only on infra
  // failures.
  readonly lookupBySubdomain: TenantLookup;
  // tenantId → exists?. Called when a visitor presents an X-Tenant header
  // or kumiko_tenant cookie (so a cookie that survives a server restart
  // still re-validates against the DB on first use). Apps usually wrap
  // the same tenants table — keep the implementation symmetric to
  // lookupBySubdomain.
  readonly existsById: TenantExistsLookup;
  // Apex / non-tenant hosts that should NOT be resolved. Common pattern:
  // `shop.com` is the marketing site, `app.shop.com` is the admin app —
  // anonymous traffic to those should 404 rather than land on a default.
  readonly reservedSubdomains?: readonly string[];
  // TTL in seconds. Default 300s (5min) — see top-of-file rationale.
  readonly cacheTtlSeconds?: number;
};

type CacheEntry<T> = { value: T; expiresAt: number };

// Builds resolver + tenantExists that share independent caches by lookup
// key (subdomain vs tenantId), so the two callbacks each amortise their
// own DB load. Apps drop the returned object into
// `anonymousAccess: { tenantResolver: r.tenantResolver, tenantExists: r.tenantExists }`.
export function createSubdomainResolver(opts: SubdomainResolverOptions): {
  tenantResolver: (c: {
    req: { url: string; header: (name: string) => string | undefined };
  }) => Promise<TenantId | null>;
  tenantExists: (id: TenantId) => Promise<boolean>;
  invalidate: (subdomainOrTenantId: string) => void;
  invalidateAll: () => void;
} {
  const ttlMs = (opts.cacheTtlSeconds ?? 300) * 1000;
  const reserved = new Set(opts.reservedSubdomains ?? ["www", "app", "api", "admin"]);
  const subdomainCache = new Map<string, CacheEntry<TenantId | null>>();
  const existsCache = new Map<TenantId, CacheEntry<boolean>>();

  async function lookupBySubdomainCached(subdomain: string): Promise<TenantId | null> {
    const now = Date.now();
    const cached = subdomainCache.get(subdomain);
    if (cached && cached.expiresAt > now) return cached.value;

    const tenantId = await opts.lookupBySubdomain(subdomain);
    subdomainCache.set(subdomain, { value: tenantId, expiresAt: now + ttlMs });
    return tenantId;
  }

  async function existsByIdCached(tenantId: TenantId): Promise<boolean> {
    const now = Date.now();
    const cached = existsCache.get(tenantId);
    if (cached && cached.expiresAt > now) return cached.value;

    const exists = await opts.existsById(tenantId);
    existsCache.set(tenantId, { value: exists, expiresAt: now + ttlMs });
    return exists;
  }

  return {
    tenantResolver: async (c) => {
      const host = c.req.header("Host");
      if (!host) return null;
      const subdomain = extractSubdomain(host);
      if (subdomain === null) return null;
      if (reserved.has(subdomain)) return null;
      return lookupBySubdomainCached(subdomain);
    },
    tenantExists: existsByIdCached,
    invalidate: (key) => {
      subdomainCache.delete(key);
      existsCache.delete(key as TenantId);
    },
    invalidateAll: () => {
      subdomainCache.clear();
      existsCache.clear();
    },
  };
}

// Extracts the leftmost DNS label, dropping the port and assuming the
// host has at least 3 labels (subdomain.domain.tld). Bare hosts like
// "localhost" or "shop.com" return null so the caller falls through to
// the "no tenant" branch.
export function extractSubdomain(host: string): string | null {
  const noPort = host.split(":")[0] ?? host;
  const labels = noPort.split(".");
  if (labels.length < 3) return null;
  return labels[0] ?? null;
}
