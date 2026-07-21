/**
 * Merge app-facing AnonymousAccessConfig with auth-foundation tenant providers.
 * Providers win over any leftover callback fields (hard cutover #1374).
 * Test stacks may still pass Resolved callbacks when no provider is mounted.
 */
import type {
  AnonymousAccessConfig,
  AnonymousAccessResolved,
  TenantExists,
  TenantResolver,
} from "@cosmicdrift/kumiko-framework/api";
import type { Registry } from "@cosmicdrift/kumiko-framework/engine";
import { resolveTenantExistence, resolveTenantResolver } from "./feature";
import type { AuthProviderBuildDeps } from "./types";

export async function resolveAnonymousAccessFromRegistry(
  base: AnonymousAccessResolved | AnonymousAccessConfig | undefined,
  deps: AuthProviderBuildDeps & { readonly registry: Registry },
): Promise<AnonymousAccessResolved | undefined> {
  const [tenantResolver, tenantExists] = await Promise.all([
    resolveTenantResolver(deps),
    resolveTenantExistence(deps),
  ]);

  if (!base && !tenantResolver && !tenantExists) return undefined;

  // Fail-closed (#1374 security): inline tenantResolver without trust is the
  // old ambiguous config — providers always carry trust; test stacks must too.
  if (
    !tenantResolver &&
    base &&
    "tenantResolver" in base &&
    base.tenantResolver !== undefined &&
    base.resolverTrust === undefined
  ) {
    throw new Error(
      "[auth-foundation] anonymousAccess.tenantResolver is set without resolverTrust — " +
        'declare "authoritative" or "fallback-only" (or mount an EXT_TENANT_RESOLVER provider).',
    );
  }

  // Providers win (#1374). When none are mounted, keep any test-injected
  // Resolved callbacks so framework middleware suites stay self-contained.
  return {
    ...(base ?? {}),
    ...(tenantResolver
      ? {
          tenantResolver: tenantResolver.resolve as TenantResolver,
          resolverTrust: tenantResolver.trust,
        }
      : {}),
    ...(tenantExists ? { tenantExists: tenantExists as TenantExists } : {}),
  };
}
