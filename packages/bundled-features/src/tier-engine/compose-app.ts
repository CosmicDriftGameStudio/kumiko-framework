import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";

/**
 * Tier definition — a named bundle of features + caps.
 *
 * **Generic over `TCaps`:** the app defines its cap shape as a concrete
 * type (e.g. `{ apps: number, mailsPerMonth: number, aiTokens: number }`)
 * and the composeApp call returns exactly that shape. No
 * `as Record<string, unknown>` casts are needed in app code; all cap reads
 * are compile-time checked.
 *
 * The tier engine itself is **agnostic** to concrete tier values and cap
 * dimensions. Each app defines its TierMap: kumiko.rocks has
 * free/pro/business/enterprise/self-host, while PublicStatus has
 * free/starter/team/agency. The engine stores only the tier name as a
 * string and trusts the app's TierMap to define what it means at boot.
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
 * `capOverrides` is `Partial<TCaps>` because an add-on overrides only
 * individual cap values (e.g. “Dedicated-Stack increases mailsPerMonth to
 * 100k”), rather than redefining the entire shape.
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
 *   1. base features always mount (the Tier-Engine itself is part of them)
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
 *
 * **No production callers, and that is not rot** — see
 * docs/reference/tier-composition-boot-vs-runtime.md for why.
 */
function lookupOrThrow<TValue>(
  map: Readonly<Record<string, TValue>>,
  name: string,
  kind: string,
  knownLabel: string,
): TValue {
  const value = map[name];
  if (!value) {
    throw new Error(
      `composeApp: unknown ${kind} "${name}". ${knownLabel}: ${Object.keys(map).join(", ")}`,
    );
  }
  return value;
}

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

  const addOnDefs = input.addOns.map((name) =>
    lookupOrThrow(input.addOnMap, name, "add-on", "Known add-ons"),
  );

  const tierFeatureNames = tierDef.features;
  const addOnFeatureNames = addOnDefs.flatMap((d) => d.features);
  const allFeatureNames = [...tierFeatureNames, ...addOnFeatureNames];

  const additionalFeatures = allFeatureNames.map((name) =>
    lookupOrThrow(input.featureRegistry, name, "feature", "Registered features"),
  );

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
  // Object.assign mutates the local `merged` (allocated once, not in
  // an accumulating-spread loop — Biome's noAccumulatingSpread is happy
  // and we still avoid an `as TCaps` cast: TS narrows the assign-result
  // back to TCaps when source is Partial<TCaps>.
  const merged: TCaps = { ...tierDef.caps };
  for (const def of addOnDefs) {
    if (def.capOverrides) Object.assign(merged, def.capOverrides);
  }
  const effectiveCaps = merged;

  return {
    features: [...input.base, ...dedupedFeatures],
    caps: effectiveCaps,
  };
}
