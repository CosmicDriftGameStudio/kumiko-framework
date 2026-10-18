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

export type HostRoutingTenantMode =
  // <key>.<baseDomain> names the tenant.
  | { readonly tenantBy: "host" }
  // <baseDomain><tenantPathPrefix>/<key>/... names the tenant.
  | { readonly tenantBy: "path"; readonly tenantPathPrefix: string };

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
};
