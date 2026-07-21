// kumiko-feature-version: 1
//
// auth-foundation — declares auth-middleware extension points:
//   - tokenVerifier (multi, shape-routed)
//   - sessionStore (single, required when foundation mounts)
//   - tenantResolver (single, optional)
//   - tenantExistence (single, optional)
//
// Provider-features register via `r.useExtension(EXT_*, "<name>", plugin)`.
// Middleware / runProdApp resolve providers from the registry at boot
// (tokenVerifier/sessionStore) or request-time (tokenVerifier shape match).

import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { defineFeature, type Registry } from "@cosmicdrift/kumiko-framework/engine";
import {
  validateSessionStoreMultiplicity,
  validateTenantExistenceMultiplicity,
  validateTenantResolverMultiplicity,
  validateTokenVerifierMultiplicity,
} from "./boot-checks";
import {
  type AuthProviderBuildDeps,
  EXT_SESSION_STORE,
  EXT_TENANT_EXISTENCE,
  EXT_TENANT_RESOLVER,
  EXT_TOKEN_VERIFIER,
  isAuthProviderPlugin,
  isSessionStoreProvider,
  isTenantExistenceProvider,
  isTenantResolverProvider,
  type SessionStore,
  type TenantExistsFn,
  type TenantResolverFn,
  type TenantResolverTrust,
  tokenShapeMatches,
} from "./types";

export {
  EXT_SESSION_STORE,
  EXT_TENANT_EXISTENCE,
  EXT_TENANT_RESOLVER,
  EXT_TOKEN_VERIFIER,
} from "./types";

const FEATURE_NAME = "auth-foundation";

export const authFoundationFeature = defineFeature(FEATURE_NAME, (r) => {
  r.describe(
    "Declares auth-middleware extension points: `tokenVerifier` (Bearer), `sessionStore` (revocable JWT sid), optional `tenantResolver` + `tenantExistence` for anonymous multi-tenant. Provider-features register via r.useExtension; mount auth-foundation with the matching provider features.",
  );
  r.uiHints({
    displayLabel: "Auth Provider Foundation",
    category: "identity",
    recommended: false,
  });

  r.extendsRegistrar(EXT_TOKEN_VERIFIER, {
    onRegister: () => {
      // No side-effects at register-time — registry stores the usage,
      // resolveTokenVerifier looks it up at request-time.
    },
  });
  r.bootCheck(({ features }) => validateTokenVerifierMultiplicity(features));

  r.extendsRegistrar(EXT_SESSION_STORE, {
    onRegister: () => {
      // No side-effects at register-time — resolveSessionStore at boot/request.
    },
  });
  r.bootCheck(({ features }) => validateSessionStoreMultiplicity(features));

  r.extendsRegistrar(EXT_TENANT_RESOLVER, {
    onRegister: () => {
      // Optional — zero providers is fine (single-tenant / header-cookie).
    },
  });
  r.bootCheck(({ features }) => validateTenantResolverMultiplicity(features));

  r.extendsRegistrar(EXT_TENANT_EXISTENCE, {
    onRegister: () => {
      // Optional — zero providers skips the existence check.
    },
  });
  r.bootCheck(({ features }) => validateTenantExistenceMultiplicity(features));
});

/**
 * Tries every registered tokenVerifier provider's shape against `rawToken`
 * in registration order and calls the first match's verifier. Returns null
 * when no provider's shape matches, or when the matching provider's
 * verifier rejects the token.
 */
export async function resolveTokenVerifier(
  deps: AuthProviderBuildDeps & { readonly registry: Registry },
  rawToken: string,
): Promise<SessionUser | null> {
  const usages = deps.registry.getExtensionUsages(EXT_TOKEN_VERIFIER);
  for (const usage of usages) {
    if (!isAuthProviderPlugin(usage.options)) continue;
    if (!tokenShapeMatches(usage.options.shape, rawToken)) continue;
    const verify = await usage.options.build(deps);
    return verify(rawToken);
  }
  return null;
}

/**
 * Resolves the single registered sessionStore provider. Assumes
 * validateSessionStoreMultiplicity already ran at boot — a missing provider
 * here means the app booted without going through the framework's boot
 * validator, not a runtime state resolveSessionStore should model.
 */
export async function resolveSessionStore(
  deps: AuthProviderBuildDeps & { readonly registry: Registry },
): Promise<SessionStore> {
  const usage = deps.registry.getExtensionUsages(EXT_SESSION_STORE)[0];
  if (!usage || !isSessionStoreProvider(usage.options)) {
    throw new Error(
      "[auth-foundation] no sessionStore provider registered — did the boot validator run?",
    );
  }
  return usage.options.build(deps);
}

export type ResolvedTenantResolver = {
  readonly resolve: TenantResolverFn;
  readonly trust: TenantResolverTrust;
};

/** Optional tenantResolver — null when no provider registered. */
export async function resolveTenantResolver(
  deps: AuthProviderBuildDeps & { readonly registry: Registry },
): Promise<ResolvedTenantResolver | null> {
  const usage = deps.registry.getExtensionUsages(EXT_TENANT_RESOLVER)[0];
  if (!usage) return null;
  if (!isTenantResolverProvider(usage.options)) {
    throw new Error(
      "[auth-foundation] tenantResolver provider registered without a valid TenantResolverProvider",
    );
  }
  const resolve = await usage.options.build(deps);
  return { resolve, trust: usage.options.trust };
}

/** Optional tenantExistence — null when no provider registered. */
export async function resolveTenantExistence(
  deps: AuthProviderBuildDeps & { readonly registry: Registry },
): Promise<TenantExistsFn | null> {
  const usage = deps.registry.getExtensionUsages(EXT_TENANT_EXISTENCE)[0];
  if (!usage) return null;
  if (!isTenantExistenceProvider(usage.options)) {
    throw new Error(
      "[auth-foundation] tenantExistence provider registered without a valid TenantExistenceProvider",
    );
  }
  return usage.options.build(deps);
}
