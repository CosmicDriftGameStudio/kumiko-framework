// kumiko-feature-version: 1
//
// auth-foundation — declares the `tokenVerifier` extension point for Bearer-
// token verification. Provider-features (auth-provider-jwt, auth-provider-
// pat, ...) register via `r.useExtension(EXT_TOKEN_VERIFIER, "<name>", plugin)`.
//
// **Scaffold only:** not wired into `api/auth-middleware.ts` yet —
// personal-access-tokens still uses its own direct `patResolver` callback
// (kumiko-framework#745). A future issue migrates the middleware onto this
// extension point; #1368 only lays the groundwork (PAT-Plan-Doc Phase-1-
// Sub-Step-1).
//
// **Pattern precedent:** file-foundation/mail-foundation for the extension-
// point + plugin-registry shape. Diverges on ROUTING: those pick one active
// provider per tenant via a config-key; auth-foundation has no tenant yet
// at verify-time, so providers are tried in shape-match order instead (see
// types.ts).

import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { defineFeature, type Registry } from "@cosmicdrift/kumiko-framework/engine";
import { validateTokenVerifierMultiplicity } from "./boot-checks";
import {
  type AuthProviderBuildDeps,
  EXT_TOKEN_VERIFIER,
  isAuthProviderPlugin,
  tokenShapeMatches,
} from "./types";

export { EXT_TOKEN_VERIFIER } from "./types";

const FEATURE_NAME = "auth-foundation";

export const authFoundationFeature = defineFeature(FEATURE_NAME, (r) => {
  r.describe(
    "Defines the `tokenVerifier` extension point for Bearer-token verification. Provider-features register a static `shape` (how to recognize their own tokens) plus a `build()` that produces a verifier — mount together with at least one auth-provider-* feature and call `resolveTokenVerifier(deps, rawToken)` to find the matching one.",
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

  // Owns EXT_TOKEN_VERIFIER, so its own mount is the trigger — same
  // convention as tenant-lifecycle/user-data-rights' self-bootCheck.
  r.bootCheck(({ features }) => validateTokenVerifierMultiplicity(features));
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
