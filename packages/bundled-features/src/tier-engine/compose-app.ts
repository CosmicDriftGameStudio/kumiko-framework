import type { FeatureDefinition } from "@kumiko/framework/engine";

/**
 * Tier definition — a named bundle of features + caps.
 *
 * The Tier-Engine itself is **agnostic** to which tiers exist. Each app
 * defines its own TierMap: kumiko.so has free/pro/business/enterprise/
 * self-host, PublicStatus has free/starter/team/agency. The engine just
 * stores the tier name as a string and trusts the app's TierMap to know
 * what that means at boot time.
 */
export type TierDefinition = {
  /** Feature names to mount on top of the base set (no add-ons applied). */
  readonly features: readonly string[];
  /** Cap-Definitions als app-spezifischer Type. Engine speichert nicht, leitet weiter. */
  readonly caps: Readonly<Record<string, unknown>>;
};

/**
 * Add-On definition — a tier-orthogonal feature bundle that can be
 * added to any tier (BYOK-Encryption, Dedicated-Stack, Custom-SLA, ...).
 */
export type AddOnDefinition = {
  /** Feature names to mount additionally when this add-on is active. */
  readonly features: readonly string[];
  /** Cap-Overrides (replaces matching keys in the tier's cap set). */
  readonly capOverrides?: Readonly<Record<string, unknown>>;
};

export type TierMap = Readonly<Record<string, TierDefinition>>;
export type AddOnMap = Readonly<Record<string, AddOnDefinition>>;

export type ComposeAppInput = {
  /** Features that mount unconditionally — auth, tenant, secrets, tier-engine itself. */
  readonly base: readonly FeatureDefinition[];
  /** All app-specific features keyed by their feature-name. */
  readonly featureRegistry: Readonly<Record<string, FeatureDefinition>>;
  /** App's tier definitions. */
  readonly tierMap: TierMap;
  /** App's add-on definitions. */
  readonly addOnMap: AddOnMap;
  /** Active tier name for the current platform-tenant. */
  readonly tier: string;
  /** Active add-on names for the current platform-tenant. */
  readonly addOns: readonly string[];
};

export type ComposedApp = {
  /** Final feature list to pass to runProdApp / setupTestStack. */
  readonly features: readonly FeatureDefinition[];
  /** Effective caps after tier + add-on overrides. */
  readonly caps: Readonly<Record<string, unknown>>;
};

/**
 * composeApp — compute the feature-set + caps for a platform-tenant.
 *
 * **Contract:**
 *   1. base features always mount (Tier-Engine itself ist Teil davon)
 *   2. plus tier-specific features (from tierMap[tier].features)
 *   3. plus add-on features (from addOnMap[addOn].features for each active add-on)
 *   4. caps = tier.caps ⊕ add-on.capOverrides (later add-ons override earlier)
 *
 * **Failure modes:**
 *   - tier not in tierMap → throws (config error, app must register valid tiers)
 *   - addOn not in addOnMap → throws (same)
 *   - feature-name not in featureRegistry → throws (same)
 *
 * **Why throw vs silently ignore:** unknown tier/add-on means a Stripe-webhook
 * delivered something the platform doesn't understand. Failing loud at boot
 * is safer than silently mounting the wrong feature-set and hoping nobody
 * notices when "Pro" turns out to mean "Free".
 */
export function composeApp(input: ComposeAppInput): ComposedApp {
  const tierDef = input.tierMap[input.tier];
  if (!tierDef) {
    throw new Error(
      `composeApp: unknown tier "${input.tier}". Known tiers: ` +
        `${Object.keys(input.tierMap).join(", ")}`,
    );
  }

  const addOnDefs = input.addOns.map((name) => {
    const def = input.addOnMap[name];
    if (!def) {
      throw new Error(
        `composeApp: unknown add-on "${name}". Known add-ons: ` +
          `${Object.keys(input.addOnMap).join(", ")}`,
      );
    }
    return def;
  });

  const tierFeatureNames = tierDef.features;
  const addOnFeatureNames = addOnDefs.flatMap((d) => d.features);
  const allFeatureNames = [...tierFeatureNames, ...addOnFeatureNames];

  const additionalFeatures = allFeatureNames.map((name) => {
    const feature = input.featureRegistry[name];
    if (!feature) {
      throw new Error(
        `composeApp: unknown feature "${name}". Registered features: ` +
          `${Object.keys(input.featureRegistry).join(", ")}`,
      );
    }
    return feature;
  });

  // Dedupe — a feature listed in both the tier and an add-on should only
  // mount once. Order-preserving: first occurrence wins.
  const seen = new Set<string>();
  const dedupedFeatures = additionalFeatures.filter((f) => {
    if (seen.has(f.name)) return false;
    seen.add(f.name);
    return true;
  });

  // Caps merge: tier.caps as base, each add-on's overrides applied on top.
  // Later add-ons win — order in input.addOns matters for conflicting overrides.
  const effectiveCaps: Record<string, unknown> = { ...tierDef.caps };
  for (const def of addOnDefs) {
    if (def.capOverrides) {
      Object.assign(effectiveCaps, def.capOverrides);
    }
  }

  return {
    features: [...input.base, ...dedupedFeatures],
    caps: effectiveCaps,
  };
}
