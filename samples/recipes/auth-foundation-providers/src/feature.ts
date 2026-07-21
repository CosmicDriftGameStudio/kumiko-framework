// Auth-foundation providers — custom tenantResolver + tenantExistence
//
// After #1374, apps do NOT pass tenantResolver/tenantExists on
// anonymousAccess. They mount a feature that registers providers via
// r.useExtension(EXT_TENANT_RESOLVER / EXT_TENANT_EXISTENCE). Boot
// (runProdApp / runDevApp) merges them through
// resolveAnonymousAccessFromRegistry.
//
// What to copy:
//
//   composeFeatures([
//     authFoundationFeature,
//     createSubdomainTenantRoutingFeature({ lookupBySubdomain, existsById }),
//     …appFeatures,
//   ], { includeBundled: true })
//
//   anonymousAccess: { /* defaultTenantId only, if single-tenant */ }
//
// Pair with samples/recipes/anonymous-access-multitenant for the
// subdomain+cache lookup helpers (reuse createSubdomainResolver inside
// the provider build).

import {
  EXT_TENANT_EXISTENCE,
  EXT_TENANT_RESOLVER,
  type TenantExistenceProvider,
  type TenantResolverProvider,
} from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import {
  defineFeature,
  type FeatureDefinition,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";

export type SubdomainTenantRoutingOptions = {
  readonly lookupBySubdomain: (subdomain: string) => Promise<TenantId | null>;
  readonly existsById: (tenantId: TenantId) => Promise<boolean>;
  readonly reservedSubdomains?: readonly string[];
  /** Provider trust — usually "authoritative" for Host-derived tenants. */
  readonly trust?: "authoritative" | "fallback-only";
};

export function createSubdomainTenantRoutingFeature(
  opts: SubdomainTenantRoutingOptions,
): FeatureDefinition {
  const trust = opts.trust ?? "authoritative";
  const reserved = new Set(opts.reservedSubdomains ?? ["www", "app", "api", "admin"]);

  return defineFeature("sample-subdomain-tenant-routing", (r) => {
    r.requires("auth-foundation");

    const resolverPlugin: TenantResolverProvider = {
      trust,
      build: () => async (c: unknown) => {
        const ctx = c as {
          req: { header: (n: string) => string | undefined };
        };
        const host = ctx.req.header("Host");
        if (!host) return null;
        const noPort = host.split(":")[0] ?? host;
        const labels = noPort.split(".");
        if (labels.length < 3) return null;
        const subdomain = labels[0] ?? null;
        if (subdomain === null || reserved.has(subdomain)) return null;
        return opts.lookupBySubdomain(subdomain);
      },
    };

    const existencePlugin: TenantExistenceProvider = {
      build: () => (tenantId) => opts.existsById(tenantId as TenantId),
    };

    r.useExtension(EXT_TENANT_RESOLVER, "subdomain", resolverPlugin);
    r.useExtension(EXT_TENANT_EXISTENCE, "db", existencePlugin);
  });
}
