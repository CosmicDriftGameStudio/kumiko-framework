import type { FeatureDefinition } from "@kumiko/framework/engine";

/**
 * Tier definition — a named bundle of features + caps.
 *
 * **Generic über `TCaps`:** die App definiert ihren Cap-Shape als konkreten
 * Type (z.B. `{ apps: number, mailsPerMonth: number, aiTokens: number }`)
 * und der composeApp-Aufruf liefert exakt diesen Shape zurück. Keine
 * `as Record<string, unknown>`-Casts in App-Code, alle Cap-Reads sind
 * compile-time-checked.
 *
 * Die Tier-Engine selbst ist **agnostisch** zu konkreten Tier-Werten und
 * Cap-Dimensionen. Jede App definiert ihre TierMap: kumiko.so hat
 * free/pro/business/enterprise/self-host, PublicStatus hat
 * free/starter/team/agency. Die Engine speichert nur den Tier-Namen als
 * String und vertraut der App's TierMap, was das beim Boot bedeutet.
 */
export type TierDefinition<TCaps extends Readonly<Record<string, unknown>>> = {
  /** Feature names to mount on top of the base set (no add-ons applied). */
  readonly features: readonly string[];
  /** Cap-Definition als app-spezifischer typed shape. */
  readonly caps: TCaps;
};

/**
 * Add-On definition — a tier-orthogonal feature bundle that can be added
 * to any tier (BYOK-Encryption, Dedicated-Stack, Custom-SLA, ...).
 *
 * `capOverrides` ist `Partial<TCaps>` weil ein Add-On nur einzelne Cap-
 * Werte überschreibt (z.B. „Dedicated-Stack erhöht mailsPerMonth auf
 * 100k"), nicht den ganzen Shape neu definiert.
 */
export type AddOnDefinition<TCaps extends Readonly<Record<string, unknown>>> = {
  /** Feature names to mount additionally when this add-on is active. */
  readonly features: readonly string[];
  /** Cap-Overrides (replaces matching keys in the tier's cap set). */
  readonly capOverrides?: Partial<TCaps>;
};

export type TierMap<TCaps extends Readonly<Record<string, unknown>>> = Readonly<
  Record<string, TierDefinition<TCaps>>
>;
export type AddOnMap<TCaps extends Readonly<Record<string, unknown>>> = Readonly<
  Record<string, AddOnDefinition<TCaps>>
>;

export type ComposeAppInput<TCaps extends Readonly<Record<string, unknown>>> = {
  /** Features that mount unconditionally — auth, tenant, secrets, tier-engine itself. */
  readonly base: readonly FeatureDefinition[];
  /** All app-specific features keyed by their feature-name. */
  readonly featureRegistry: Readonly<Record<string, FeatureDefinition>>;
  /** App's tier definitions. */
  readonly tierMap: TierMap<TCaps>;
  /** App's add-on definitions. */
  readonly addOnMap: AddOnMap<TCaps>;
  /** Active tier name for the current platform-tenant. */
  readonly tier: string;
  /** Active add-on names for the current platform-tenant. */
  readonly addOns: readonly string[];
};

export type ComposedApp<TCaps extends Readonly<Record<string, unknown>>> = {
  /** Final feature list to pass to runProdApp / setupTestStack. */
  readonly features: readonly FeatureDefinition[];
  /** Effective caps after tier + add-on overrides — same shape as input.tierMap[*].caps. */
  readonly caps: TCaps;
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
export function composeApp<TCaps extends Readonly<Record<string, unknown>>>(
  input: ComposeAppInput<TCaps>,
): ComposedApp<TCaps> {
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
  // reduce<TCaps> with the typed accumulator avoids any cast: spread of
  // T plus Partial<T> structurally narrows back to T.
  const effectiveCaps = addOnDefs.reduce<TCaps>(
    (acc, def) => (def.capOverrides ? { ...acc, ...def.capOverrides } : acc),
    tierDef.caps,
  );

  return {
    features: [...input.base, ...dedupedFeatures],
    caps: effectiveCaps,
  };
}
