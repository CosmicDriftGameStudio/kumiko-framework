// Sprint-8a Tier-Composition: framework-extension-point für per-tenant
// effective-feature resolution.
//
// **Pattern (analog mail-foundation / file-foundation):** ein Feature
// declares `r.extendsRegistrar("tenantTierResolver")` und plugins
// implementieren via `r.useExtension("tenantTierResolver", "id", { build })`.
//
// **Auto-wiring im Framework:** runDevApp + runProdApp scannen das registry
// nach genau diesem extension-name. Wenn ein plugin gefunden ist UND der
// App-Author nicht selbst eine `effectiveFeatures`-callback gesetzt hat,
// wird `plugin.build({ db, registry })` einmalig in onAfterSetup aufgerufen.
// Der returned callback landet als `effectiveFeatures` im dispatcher.
//
// **Warum dieser Pattern:** App-Author mountet `createTierEngineFeature(opts)`
// und das war's — kein Late-Bound-Holder im run-config, kein
// effectiveFeatures-callback wiren. Das Framework macht den Late-Bound-Trick
// intern. Memory `feedback_alles_ist_ein_feature`: Tier-Composition ist
// ein Feature, nicht ein Subsystem mit App-spezifischem Wiring.
//
// **Apps ohne tier-engine:** wenn keine plugin registriert ist, framework
// macht nichts — `effectiveFeatures` bleibt undefined, alle features sind on.

import type { DbConnection } from "../db/connection";
import type { RegistrarExtensionRegistration } from "./types/config";
import type { FeatureDefinition, Registry } from "./types/feature";
import type { TenantId } from "./types/identifiers";

/**
 * Extension-name unter dem ein tier-resolver-plugin im registry registriert
 * werden muss. Konstante damit `r.useExtension(TENANT_TIER_RESOLVER_EXT, ...)`
 * + framework's `getExtensionUsages(TENANT_TIER_RESOLVER_EXT)` typo-resistent
 * gegen den selben Wert prüfen.
 */
export const TENANT_TIER_RESOLVER_EXT = "tenantTierResolver";

/**
 * Resolver-callback shape: synchron (dispatcher hot-path), per-tenant.
 * Returnt das effective feature-Set für den tenant. Implementations sollten
 * einen in-memory cache pflegen + per `r.entityHook` invalidieren.
 *
 * **System-context convention:** call mit SYSTEM_TENANT_ID erwartet die union
 * aller tier-features (siehe DispatcherOptions.effectiveFeatures doc-block).
 */
export type EffectiveFeaturesResolver = ((tenantId: TenantId) => ReadonlySet<string>) & {
  /**
   * Optionaler Live-Trial-Gate, vom dispatcher-feature-gate NUR konsultiert
   * wenn der synchrone Resolver ein Feature als disabled meldet. Liest das
   * Signup-Datum des Tenants live (tenant.inserted_at) und returnt true wenn
   * der Tenant im Trial-Fenster ist UND das Feature zum Trial-Tier gehört.
   * Async + nicht im Boot-Cache, weil der Trial zeit-abgeleitet ist (ändert
   * sich zwischen Requests). Nur die 2 Gate-Aufrufstellen awaiten ihn; der
   * synchrone Hot-Path (ctx.hasFeature, Feature-Set) bleibt unberührt.
   */
  readonly trialGate?: TrialGate;
};

/**
 * Live-Trial-Gate-Shape. Siehe EffectiveFeaturesResolver.trialGate.
 */
export type TrialGate = (tenantId: TenantId, featureName: string) => Promise<boolean>;

/**
 * Plugin-shape für tier-resolver-extension. Plugins implementieren `build`
 * als boot-time factory: kriegen `db` + `registry` (post-stack-setup),
 * laden initial cache aus DB, returnen den synchronen resolver-callback
 * (optional mit angehängtem `trialGate`).
 */
export type TierResolverPlugin = {
  readonly build: (deps: {
    readonly db: DbConnection;
    readonly registry: Registry;
  }) => Promise<EffectiveFeaturesResolver>;
};

/**
 * Scan a composed feature-list for a `tenantTierResolver`-extension usage.
 * Single plugin assumption — multiple wären ambiguous (welcher resolver
 * gewinnt). Memory `feedback_no_options_without_need`: kein multi-merge-
 * pattern bis es echten Use-Case gibt.
 *
 * Geteilter helper für runDevApp + runProdApp damit der Pickup-Pfad
 * bit-identisch ist (drift-resistent).
 */
export function findTierResolverUsage(
  features: readonly FeatureDefinition[],
): RegistrarExtensionRegistration | undefined {
  for (const feature of features) {
    for (const usage of feature.extensionUsages) {
      if (usage.extensionName === TENANT_TIER_RESOLVER_EXT) {
        return usage;
      }
    }
  }
  return undefined;
}
