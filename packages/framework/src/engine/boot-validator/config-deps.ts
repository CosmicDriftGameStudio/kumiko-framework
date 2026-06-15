import type { FeatureDefinition } from "../types";

// --- Toggleable-dependency warnings ---
//
// When feature A declares r.requires("B") and B is toggleable with
// default=false, A is effectively disabled out-of-the-box until someone
// flips B on globally. That's usually an oversight — the dev either meant
// optionalRequires, or forgot to ship B with default=true. We warn (not
// fail) because the combination is legal: an app might intentionally
// require an opt-in feature to make it explicit that B must be activated.
export function warnOnToggleableDependencies(
  features: readonly FeatureDefinition[],
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  for (const f of features) {
    for (const dep of f.requires) {
      const depFeature = featureMap.get(dep);
      if (!depFeature) continue; // requires-target-missing is handled elsewhere
      if (depFeature.toggleableDefault === false) {
        // biome-ignore lint/suspicious/noConsole: boot-time dev hint, no logger available yet
        console.warn(
          `[kumiko:boot] Feature "${f.name}" requires "${dep}", which is toggleable(default=false). ` +
            `"${f.name}" will be effectively disabled until "${dep}" is enabled globally via the feature-toggles feature. ` +
            `If this is intentional, ignore this warning; otherwise consider r.optionalRequires() or default=true.`,
        );
      }
    }
  }
}

// --- Config key bounds consistency ---

export function validateConfigKeyBounds(feature: FeatureDefinition): void {
  for (const [keyName, keyDef] of Object.entries(feature.configKeys)) {
    const bounds = keyDef.bounds;
    // skip: no bounds declared, nothing to validate
    if (!bounds) continue;

    // Bounds on non-number keys are nonsensical — the call-site type-guard
    // already rejects this, but catch it at boot as defence in depth (e.g.
    // a hand-rolled key definition that bypasses createTenantConfig).
    if (keyDef.type !== "number") {
      throw new Error(
        `[Feature ${feature.name}] Config key "${keyName}" has bounds but type is "${keyDef.type}" — bounds are only valid for type="number"`,
      );
    }

    const { min, max } = bounds;

    if (min !== undefined && max !== undefined && min > max) {
      throw new Error(
        `[Feature ${feature.name}] Config key "${keyName}" has bounds.min (${min}) > bounds.max (${max})`,
      );
    }

    if (keyDef.default !== undefined) {
      const defaultNum = keyDef.default as number; // @cast-boundary engine-payload
      if (min !== undefined && defaultNum < min) {
        throw new Error(
          `[Feature ${feature.name}] Config key "${keyName}" default (${defaultNum}) is below bounds.min (${min})`,
        );
      }
      if (max !== undefined && defaultNum > max) {
        throw new Error(
          `[Feature ${feature.name}] Config key "${keyName}" default (${defaultNum}) is above bounds.max (${max})`,
        );
      }
    }
  }
}

// --- Config key computed + encrypted exclusivity ---

export function validateConfigKeyComputed(feature: FeatureDefinition): void {
  for (const [keyName, keyDef] of Object.entries(feature.configKeys)) {
    if (!keyDef.computed) continue;

    // computed + encrypted mix two paradigms that shouldn't meet: computed
    // returns a plain value, encrypted expects cipher-text in the row. The
    // cascade doesn't know which one to prefer on write. Rejecting at boot
    // is cheaper than surprising behaviour at runtime.
    if (keyDef.encrypted) {
      throw new Error(
        `[Feature ${feature.name}] Config key "${keyName}" has both encrypted=true and a computed resolver — these are mutually exclusive paradigms`,
      );
    }
  }
}

// --- Config key required/default compatibility ---

export function validateConfigKeyRequired(feature: FeatureDefinition): void {
  for (const [keyName, keyDef] of Object.entries(feature.configKeys ?? {})) {
    if (keyDef.required !== true) continue;
    // required heißt "Tenant MUSS konfigurieren" — ein non-empty default
    // oder ein computed-Resolver macht den Key nie unset, readiness könnte
    // die Lücke nie melden: der required-Flag wäre eine stille Lüge.
    if (keyDef.computed !== undefined) {
      throw new Error(
        `[Feature ${feature.name}] Config key "${keyName}" has required=true AND a computed resolver — a computed key can never be missing; drop one of the two`,
      );
    }
    const d = keyDef.default;
    const nonEmptyDefault = d !== undefined && !(typeof d === "string" && d.trim().length === 0);
    if (nonEmptyDefault) {
      throw new Error(
        `[Feature ${feature.name}] Config key "${keyName}" has required=true AND a non-empty default (${JSON.stringify(d)}) — the key can never be unset, readiness would never flag it; use default "" or drop required`,
      );
    }
  }
}

// --- Config key allowPerRequest compatibility ---

export function validateConfigKeyAllowPerRequest(feature: FeatureDefinition): void {
  for (const [keyName, keyDef] of Object.entries(feature.configKeys)) {
    if (!keyDef.allowPerRequest) continue;

    // text is hard-locked against per-request — the helper refuses
    // anyway, but declaring allowPerRequest on a text key is a
    // misconfiguration that should fail loudly at boot.
    if (keyDef.type === "text") {
      throw new Error(
        `[Feature ${feature.name}] Config key "${keyName}" has allowPerRequest=true but type="text" — text keys are permanently ineligible for per-request overrides (XSS/injection risk)`,
      );
    }

    // encrypted + per-request would expose a cipher-text interpretation
    // to query-strings. The secret-value shouldn't be transported this
    // way — reject as a paradigm-mismatch.
    if (keyDef.encrypted) {
      throw new Error(
        `[Feature ${feature.name}] Config key "${keyName}" has allowPerRequest=true but encrypted=true — secret values may not be set via query-params`,
      );
    }
  }
}

// --- Config key storage backing × scope matrix ---

export function validateConfigKeyBacking(feature: FeatureDefinition): void {
  for (const [keyName, keyDef] of Object.entries(feature.configKeys)) {
    if (keyDef.backing !== "secrets") continue;

    // secrets storage is flat per (tenant, key) with no system→tenant cascade,
    // so a tenant- or user-scoped secret could never inherit a system default.
    // Permanent rule: secrets-backed keys must be system-scoped.
    if (keyDef.scope !== "system") {
      throw new Error(
        `[Feature ${feature.name}] Config key "${keyName}" has backing="secrets" but scope="${keyDef.scope}" — secrets storage is flat per (tenant,key) and does not cascade; backing="secrets" requires scope="system"`,
      );
    }

    // system-scoped backing="secrets" is wired end-to-end: reads dispatch
    // through the resolver's secretsReader, writes through config:write:set/
    // :reset into the secrets store (SYSTEM_TENANT_ID), masked in the query
    // handlers. The runtime contract is that the app provides
    // `extraContext.secrets` (+ a MasterKeyProvider) — a backing="secrets"
    // read/write without it throws loud at request time, not silently.
  }
}

// --- Config key cross-feature reference validation ---

export function validateConfigReads(
  features: readonly FeatureDefinition[],
  allConfigKeys: ReadonlySet<string>,
): void {
  for (const feature of features) {
    for (const key of feature.configReads) {
      if (!allConfigKeys.has(key)) {
        throw new Error(
          `Feature "${feature.name}" reads config "${key}" but no feature defines that key`,
        );
      }
    }
  }
}

// --- Circular dependency detection ---

export function validateCircularDeps(
  featureName: string,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  const visited = new Set<string>();
  const stack = new Set<string>();

  function visit(name: string, path: string[]): void {
    if (stack.has(name)) {
      throw new Error(`Circular dependency: ${[...path, name].join(" → ")}`);
    }
    // skip: node already visited in DFS traversal
    if (visited.has(name)) return;

    visited.add(name);
    stack.add(name);

    const feature = featureMap.get(name);
    if (feature) {
      for (const dep of feature.requires) {
        visit(dep, [...path, name]);
      }
    }

    stack.delete(name);
  }

  visit(featureName, []);
}
