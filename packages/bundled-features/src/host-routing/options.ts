import type { DbConnection, TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";

// What a host (or a tenant) gets served on the HTML fallback.
export type HostRoutingSurface = {
  // HTML file relative to the prod staticDir, e.g. "index.html" or "admin.html".
  readonly file: string;
  // Replaces the default CSP for this surface. Omit to keep runProdApp's default.
  readonly csp?: string;
};

export type HostRoutingApexSurface = HostRoutingSurface & {
  // Per-locale file for the apex, keyed by locale; falls back to `file`.
  readonly localeFiles?: Readonly<Record<string, string>>;
};

export type HostRoutingLocales = {
  // Served unprefixed; "/<default>/..." answers 301 to the unprefixed path.
  readonly default: string;
  // Served under "/<locale>/...".
  readonly prefixed: readonly string[];
};

// Maps a normalized hostname (lowercase, no port) that is neither the apex nor
// a fixed host to the tenant it belongs to, e.g. a subdomain or custom domain
// stored in an app table. Null means "no tenant here": the dispatch answers
// 404 and the API answers tenant_required, never a default tenant. The
// result still has to be an enabled, active tenant. Runs on every request
// that reaches such a host, so keep it to one indexed lookup.
export type HostTenantResolver = (
  host: string,
  db: DbConnection | TenantDb,
) => Promise<TenantId | null> | TenantId | null;

export type HostRoutingTenantMode =
  // <key>.<baseDomain> names the tenant.
  | {
      readonly tenantBy: "host";
      // Also serve the tenant surface on the apex under <tenantPathPrefix>/<key>/...
      readonly tenantPathPrefix?: string;
    }
  // <baseDomain><tenantPathPrefix>/<key>/... names the tenant.
  | { readonly tenantBy: "path"; readonly tenantPathPrefix: string }
  // The app resolves every other host itself (custom domains, profile subdomains).
  | {
      readonly tenantBy: HostTenantResolver;
      readonly tenantPathPrefix?: string;
    };

// Fixed, app-configured redirect. `to` is a same-origin path or an https URL;
// nothing from the request ever picks the target, only the matched remainder
// of the path is appended.
export type HostRoutingRedirect = {
  // Path (exact or as a segment prefix, e.g. "/old" matches "/old" and "/old/x").
  readonly from: string;
  readonly to: string;
  // Limits the rule to one lowercase hostname without port. Omit for every host.
  readonly host?: string;
  readonly status?: 301 | 302;
};

export type HostRoutingOptions = HostRoutingTenantMode & {
  // Apex host without port, e.g. "example.com". "www.<baseDomain>" counts as apex.
  readonly baseDomain: string;
  readonly apex: HostRoutingApexSurface;
  // Served for a known, enabled tenant (and for the bare tenant path prefix).
  readonly tenant: HostRoutingSurface;
  // Served with status 404 for an unknown or disabled tenant. Omit for a bare 404.
  readonly unknownTenant?: HostRoutingSurface;
  // Further fixed hosts (full hostname, lowercase, without port), checked first.
  readonly hosts?: Readonly<Record<string, HostRoutingSurface>>;
  readonly locales?: HostRoutingLocales;
  // Tenant for anonymous API calls on the apex (e.g. SYSTEM_TENANT_ID for
  // public signup forms). Omit and the apex answers tenant_required.
  readonly apexAnonymousTenantId?: TenantId;
  // Per apex hostname ("example.com" or "www.example.com"): the only
  // /api/query and /api/stream types that get the apexAnonymousTenantId anchor. Other anonymous
  // queries on that host get no tenant (tenant_required). "example.com" and
  // "www.example.com" share one entry: a host without its own uses the other's.
  // Other paths (e.g. /api/batch) keep the anchor for everything.
  // Not allowed with tenantBy "path" (boot error): there the client's X-Tenant
  // wins over the resolver, so the allowlist would be ineffective.
  readonly apexAnonymousQueryAllowlist?: Readonly<Record<string, readonly string[]>>;
  // Checked first, before any host classification.
  readonly redirects?: readonly HostRoutingRedirect[];
};
