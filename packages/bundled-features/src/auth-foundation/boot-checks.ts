// Multiplicity boot-check for auth-foundation's `tokenVerifier` extension
// point (#1368, #1570). Two static-shape conflicts a boot-check CAN catch (a
// runtime shape-match predicate's overlap can't be proven at boot): a
// malformed plugin registration, and two providers both claiming the same
// shape (resolveTokenVerifier can't tell them apart). Zero tokenVerifier
// providers is OK when ≥1 sessionStore is mounted (session-only cookie
// apps never use Bearer routing). Zero of both is caught here — fail-fast
// at boot ("you mounted the foundation but forgot sessions or a provider")
// rather than a runtime 401 nobody can attribute, unlike
// file-foundation/mail-foundation which defer that check to request-time
// (their provider is picked from tenant config, which doesn't exist at
// boot; auth-foundation's providers are static per-deployment, so boot is
// the right time to catch it).

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
    // Session-only apps (email-password + sessions) never hit tokenVerifier —
    // cookie JWT auth uses sessionStore alone (#1570 / phronexsis#296).
    for (const feature of features) {
      for (const usage of feature.extensionUsages) {
        // skip: sessionStore present — tokenVerifier optional for cookie-session apps.
        if (usage.extensionName === EXT_SESSION_STORE) return;
      }
    }
    throw new Error(
      "[auth-foundation] no tokenVerifier providers and no sessionStore registered — mount " +
        "at least one auth-provider-* feature (e.g. auth-provider-jwt / personal-access-tokens) " +
        "or a sessionStore (e.g. sessions) alongside auth-foundation.",
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

// Shared by the three single-provider extension points below: collect every
// registration for `ext`, validating each usage's options against `guard`,
// then fail boot on ≥2 (resolve*() has no way to route between them). Zero
// registrations is NOT checked here — it's valid for all three (a
// machine-API-only auth-foundation with PAT-bearer auth and no browser
// sessions, single-tenant deployments with no tenantResolver, etc.); the
// runtime already models "extension point unmounted" as a legal
// configuration (run-prod-app.ts only wires sessions when
// EXT_SESSION_STORE has ≥1 usage), and resolve*() throws its own clear
// error if a caller requests a provider that was never registered.
function validateSingleProvider(
  features: readonly FeatureDefinition[],
  opts: {
    readonly ext: string;
    readonly label: string;
    readonly guard: (options: unknown) => boolean;
    readonly shapeHint: string;
  },
): void {
  const { ext, label, guard, shapeHint } = opts;
  const names: string[] = [];

  for (const feature of features) {
    for (const usage of feature.extensionUsages) {
      if (usage.extensionName !== ext) continue;
      if (!guard(usage.options)) {
        throw new Error(
          `[auth-foundation] ${label} provider "${usage.entityName}" (feature "${feature.name}") ` +
            `registered without a valid ${shapeHint}.`,
        );
      }
      names.push(usage.entityName);
    }
  }

  if (names.length >= 2) {
    throw new Error(
      `[auth-foundation] ${names.length} ${label} providers registered (${names.join(", ")}) — ` +
        `only one ${label} provider may be mounted at a time.`,
    );
  }
}

// Multiplicity boot-check for the `sessionStore` extension point (#1370).
// Single-provider, unlike tokenVerifier — no shape to route on, so ≥2 fails
// boot. Zero registrations is a valid configuration (see
// validateSingleProvider doc) — a pure machine API using auth-foundation for
// PAT-bearer auth alone can mount it without also pulling in the whole
// sessions feature.
export function validateSessionStoreMultiplicity(features: readonly FeatureDefinition[]): void {
  validateSingleProvider(features, {
    ext: EXT_SESSION_STORE,
    label: "sessionStore",
    guard: isSessionStoreProvider,
    shapeHint: "SessionStoreProvider — options must have a { build } shape",
  });
}

// Optional single-provider (#1373). Zero registrations = OK (single-tenant /
// header-cookie path). ≥2 or malformed = boot fail.
export function validateTenantResolverMultiplicity(features: readonly FeatureDefinition[]): void {
  validateSingleProvider(features, {
    ext: EXT_TENANT_RESOLVER,
    label: "tenantResolver",
    guard: isTenantResolverProvider,
    shapeHint: "TenantResolverProvider — options must have { trust, build }",
  });
}

export function validateTenantExistenceMultiplicity(features: readonly FeatureDefinition[]): void {
  validateSingleProvider(features, {
    ext: EXT_TENANT_EXISTENCE,
    label: "tenantExistence",
    guard: isTenantExistenceProvider,
    shapeHint: "TenantExistenceProvider — options must have a { build } shape",
  });
}
