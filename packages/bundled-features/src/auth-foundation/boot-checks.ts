// Multiplicity boot-check for auth-foundation's `tokenVerifier` extension
// point (#1368). Two static-shape conflicts a boot-check CAN catch (a
// runtime shape-match predicate's overlap can't be proven at boot): a
// malformed plugin registration, and two providers both claiming the same
// shape (resolveTokenVerifier can't tell them apart). Zero registered
// providers is ALSO caught here — fail-fast at boot ("you mounted the
// foundation but forgot a provider") rather than a runtime 401 nobody
// can attribute, unlike file-foundation/mail-foundation which defer that
// check to request-time (their provider is picked from tenant config,
// which doesn't exist at boot; auth-foundation's providers are static
// per-deployment, so boot is the right time to catch it).

import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { EXT_TOKEN_VERIFIER, isAuthProviderPlugin, tokenShapeKey } from "./types";

export function validateTokenVerifierMultiplicity(features: readonly FeatureDefinition[]): void {
  const namesByShape = new Map<string, string[]>();

  for (const feature of features) {
    for (const usage of feature.extensionUsages) {
      if (usage.extensionName !== EXT_TOKEN_VERIFIER) continue;
      if (!isAuthProviderPlugin(usage.options)) {
        throw new Error(
          `[auth-foundation] tokenVerifier provider "${usage.entityName}" (feature "${feature.name}") ` +
            `registered without a valid AuthProviderPlugin — options must have a { shape, build } shape.`,
        );
      }
      const key = tokenShapeKey(usage.options.shape);
      const names = namesByShape.get(key) ?? [];
      names.push(usage.entityName);
      namesByShape.set(key, names);
    }
  }

  if (namesByShape.size === 0) {
    throw new Error(
      "[auth-foundation] no tokenVerifier providers registered — mount at least one " +
        "auth-provider-* feature (e.g. auth-provider-jwt) alongside auth-foundation.",
    );
  }

  for (const [key, names] of namesByShape) {
    if (names.length >= 2) {
      throw new Error(
        `[auth-foundation] ${names.length} tokenVerifier providers claim the same shape "${key}" ` +
          `(${names.join(", ")}) — resolveTokenVerifier can't route between them unambiguously. ` +
          `Give each provider a distinct shape.`,
      );
    }
  }
}
