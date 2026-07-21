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
import {
  EXT_SESSION_STORE,
  EXT_TENANT_EXISTENCE,
  EXT_TENANT_RESOLVER,
  EXT_TOKEN_VERIFIER,
  isAuthProviderPlugin,
  isSessionStoreProvider,
  isTenantExistenceProvider,
  isTenantResolverProvider,
  tokenShapeKey,
} from "./types";

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

// Multiplicity boot-check for the `sessionStore` extension point (#1370).
// Single-provider, unlike tokenVerifier — no shape to route on, so exactly
// one registration is required; 0 or ≥2 both fail boot.
export function validateSessionStoreMultiplicity(features: readonly FeatureDefinition[]): void {
  const names: string[] = [];

  for (const feature of features) {
    for (const usage of feature.extensionUsages) {
      if (usage.extensionName !== EXT_SESSION_STORE) continue;
      if (!isSessionStoreProvider(usage.options)) {
        throw new Error(
          `[auth-foundation] sessionStore provider "${usage.entityName}" (feature "${feature.name}") ` +
            `registered without a valid SessionStoreProvider — options must have a { build } shape.`,
        );
      }
      names.push(usage.entityName);
    }
  }

  if (names.length === 0) {
    throw new Error(
      "[auth-foundation] no sessionStore provider registered — mount a feature that " +
        "registers one via r.useExtension(EXT_SESSION_STORE, ...) alongside auth-foundation.",
    );
  }

  if (names.length >= 2) {
    throw new Error(
      `[auth-foundation] ${names.length} sessionStore providers registered (${names.join(", ")}) — ` +
        `only one sessionStore provider may be mounted at a time.`,
    );
  }
}

// Optional single-provider (#1373). Zero registrations = OK (single-tenant /
// header-cookie path). ≥2 or malformed = boot fail.
export function validateTenantResolverMultiplicity(features: readonly FeatureDefinition[]): void {
  const names: string[] = [];

  for (const feature of features) {
    for (const usage of feature.extensionUsages) {
      if (usage.extensionName !== EXT_TENANT_RESOLVER) continue;
      if (!isTenantResolverProvider(usage.options)) {
        throw new Error(
          `[auth-foundation] tenantResolver provider "${usage.entityName}" (feature "${feature.name}") ` +
            `registered without a valid TenantResolverProvider — options must have { trust, build }.`,
        );
      }
      names.push(usage.entityName);
    }
  }

  if (names.length >= 2) {
    throw new Error(
      `[auth-foundation] ${names.length} tenantResolver providers registered (${names.join(", ")}) — ` +
        `only one tenantResolver provider may be mounted at a time.`,
    );
  }
}

export function validateTenantExistenceMultiplicity(features: readonly FeatureDefinition[]): void {
  const names: string[] = [];

  for (const feature of features) {
    for (const usage of feature.extensionUsages) {
      if (usage.extensionName !== EXT_TENANT_EXISTENCE) continue;
      if (!isTenantExistenceProvider(usage.options)) {
        throw new Error(
          `[auth-foundation] tenantExistence provider "${usage.entityName}" (feature "${feature.name}") ` +
            `registered without a valid TenantExistenceProvider — options must have a { build } shape.`,
        );
      }
      names.push(usage.entityName);
    }
  }

  if (names.length >= 2) {
    throw new Error(
      `[auth-foundation] ${names.length} tenantExistence providers registered (${names.join(", ")}) — ` +
        `only one tenantExistence provider may be mounted at a time.`,
    );
  }
}
