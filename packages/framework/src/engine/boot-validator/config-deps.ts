import type { ConfigKeyDefinition } from "@cosmicdrift/kumiko-types/config";
import { optionsQueryFieldRefs } from "@cosmicdrift/kumiko-types/fields";
import { createFallbackLogger } from "../../logging/utils.ts";
import { isEncryptedAtRest } from "../config-helpers.ts";
import type { FeatureDefinition } from "../types/index.ts";
import { bootRuleError } from "./boot-rule.ts";
import { CONFIG_KEY_RULES } from "./config-key-rules.ts";

const log = createFallbackLogger("kumiko:boot");

// --- Toggleable-dependency warnings ---
//
// When feature A declares r.requires({ features: ["B"] }) and B is toggleable with
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
        log.warn(
          `Feature "${f.name}" requires "${dep}", which is toggleable(default=false). ` +
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
      throw bootRuleError(CONFIG_KEY_RULES.boundsNonNumber, {
        message: `[Feature ${feature.name}] Config key "${keyName}" has bounds but type is "${keyDef.type}" — bounds are only valid for type="number"`,
      });
    }

    const { min, max } = bounds;

    if (min !== undefined && max !== undefined && min > max) {
      throw bootRuleError(CONFIG_KEY_RULES.boundsMinAboveMax, {
        message: `[Feature ${feature.name}] Config key "${keyName}" has bounds.min (${min}) > bounds.max (${max}). Set bounds.min to a value at or below bounds.max.`,
      });
    }

    if (keyDef.default !== undefined) {
      const defaultNum = keyDef.default as number; // @cast-boundary engine-payload
      if (min !== undefined && defaultNum < min) {
        throw bootRuleError(CONFIG_KEY_RULES.defaultBelowMin, {
          message: `[Feature ${feature.name}] Config key "${keyName}" default (${defaultNum}) is below bounds.min (${min}). Raise the default or lower bounds.min.`,
        });
      }
      if (max !== undefined && defaultNum > max) {
        throw bootRuleError(CONFIG_KEY_RULES.defaultAboveMax, {
          message: `[Feature ${feature.name}] Config key "${keyName}" default (${defaultNum}) is above bounds.max (${max}). Lower the default or raise bounds.max.`,
        });
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
    if (isEncryptedAtRest(keyDef)) {
      throw bootRuleError(CONFIG_KEY_RULES.computedAndEncrypted, {
        message: `[Feature ${feature.name}] Config key "${keyName}" has both encrypted/backing="secrets" and a computed resolver — these are mutually exclusive paradigms. Use either encrypted/backing="secrets" or a computed resolver on one key.`,
      });
    }
  }
}

// --- Config key required/default compatibility ---

export function validateConfigKeyRequired(feature: FeatureDefinition): void {
  for (const [keyName, keyDef] of Object.entries(feature.configKeys ?? {})) {
    if (keyDef.required !== true) continue;
    // `required` means the tenant must configure the key. A non-empty default
    // or computed resolver means the key can never be unset, so readiness could
    // never report the omission and the flag would be misleading.
    if (keyDef.computed !== undefined) {
      throw bootRuleError(CONFIG_KEY_RULES.requiredWithComputed, {
        message: `[Feature ${feature.name}] Config key "${keyName}" has required=true AND a computed resolver — a computed key can never be missing; drop one of the two`,
      });
    }
    const d = keyDef.default;
    const nonEmptyDefault = d !== undefined && !(typeof d === "string" && d.trim().length === 0);
    if (nonEmptyDefault) {
      throw bootRuleError(CONFIG_KEY_RULES.requiredWithDefault, {
        message: `[Feature ${feature.name}] Config key "${keyName}" has required=true AND a non-empty default (${JSON.stringify(d)}) — the key can never be unset, readiness would never flag it; use default "" or drop required`,
      });
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
      throw bootRuleError(CONFIG_KEY_RULES.perRequestText, {
        message: `[Feature ${feature.name}] Config key "${keyName}" has allowPerRequest=true but type="text" — text keys are permanently ineligible for per-request overrides (XSS/injection risk). Remove allowPerRequest or change the key type.`,
      });
    }

    // encrypted + per-request would expose a cipher-text interpretation
    // to query-strings. The secret-value shouldn't be transported this
    // way — reject as a paradigm-mismatch.
    if (isEncryptedAtRest(keyDef)) {
      throw bootRuleError(CONFIG_KEY_RULES.perRequestEncrypted, {
        message: `[Feature ${feature.name}] Config key "${keyName}" has allowPerRequest=true but encrypted/backing="secrets" — secret values may not be set via query-params`,
      });
    }
  }
}

// --- Config key optionsQuery compatibility ---

export function validateConfigKeyOptionsQuery(feature: FeatureDefinition): void {
  for (const [keyName, keyDef] of Object.entries(feature.configKeys)) {
    const prefix = `[Feature ${feature.name}] Config key "${keyName}"`;
    if ("conditionalOptions" in keyDef) {
      throw bootRuleError(CONFIG_KEY_RULES.conditionalOptions, {
        message: `${prefix} declares conditionalOptions — conditionalOptions is only supported on entity select fields (enforced by the entity write path). Remove conditionalOptions from the config key.`,
      });
    }
    if (keyDef.optionsQuery === undefined) {
      if (keyDef.optionsQueryPayload !== undefined) {
        throw bootRuleError(CONFIG_KEY_RULES.optionsQueryPayloadWithoutQuery, {
          message: `${prefix} has optionsQueryPayload without optionsQuery. Set optionsQuery or remove optionsQueryPayload.`,
        });
      }
      continue;
    }
    if (keyDef.optionsQuery.length === 0) {
      throw bootRuleError(CONFIG_KEY_RULES.optionsQueryEmpty, {
        message: `${prefix} has an empty optionsQuery. Set it to a query name or remove it.`,
      });
    }
    if (keyDef.type !== "select") {
      throw bootRuleError(CONFIG_KEY_RULES.optionsQueryNotSelect, {
        message: `${prefix} has optionsQuery but type="${keyDef.type}" — optionsQuery is only valid on select keys`,
      });
    }
    if (keyDef.options !== undefined && keyDef.options.length > 0) {
      throw bootRuleError(CONFIG_KEY_RULES.optionsAndOptionsQuery, {
        message: `${prefix} declares both options and optionsQuery — pick one`,
      });
    }
    if (keyDef.allowPerRequest) {
      throw bootRuleError(CONFIG_KEY_RULES.optionsQueryPerRequest, {
        message: `${prefix} has optionsQuery AND allowPerRequest=true — a per-request value would bypass the option set unchecked`,
      });
    }
    validateOptionsQueryKeyRefs(feature, keyName, keyDef);
  }
}

function validateOptionsQueryKeyRefs(
  feature: FeatureDefinition,
  keyName: string,
  keyDef: ConfigKeyDefinition,
): void {
  const prefix = `[Feature ${feature.name}] Config key "${keyName}"`;
  for (const ref of optionsQueryFieldRefs(keyDef.optionsQueryPayload)) {
    if (ref === keyName) {
      throw bootRuleError(CONFIG_KEY_RULES.optionsQueryPayloadSelfReference, {
        message: `${prefix} optionsQueryPayload references itself ({ field: "${ref}" }). Reference a different config key.`,
      });
    }
    if (feature.configKeys[ref] === undefined) {
      throw bootRuleError(CONFIG_KEY_RULES.optionsQueryPayloadUnknownKey, {
        message: `${prefix} optionsQueryPayload references unknown config key "${ref}" of feature "${feature.name}"`,
      });
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
      throw bootRuleError(CONFIG_KEY_RULES.secretsScopeNotSystem, {
        message: `[Feature ${feature.name}] Config key "${keyName}" has backing="secrets" but scope="${keyDef.scope}" — secrets storage is flat per (tenant,key) and does not cascade; backing="secrets" requires scope="system"`,
      });
    }

    // system-scoped backing="secrets" is wired end-to-end: reads dispatch
    // through the resolver's secretsReader, writes through config:write:set/
    // :reset into the secrets store (SYSTEM_TENANT_ID), masked in the query
    // handlers. The runtime contract is that the app provides
    // `extraContext.secrets` (+ a MasterKeyProvider) — a backing="secrets"
    // read/write without it throws loud at request time, not silently.
  }
}

// --- Config key piiEncrypted compatibility ---

export function validateConfigKeyPiiEncrypted(feature: FeatureDefinition): void {
  for (const [keyName, keyDef] of Object.entries(feature.configKeys)) {
    if (!keyDef.piiEncrypted) continue;

    if (keyDef.type !== "text") {
      throw bootRuleError(CONFIG_KEY_RULES.piiEncryptedNotText, {
        message: `[Feature ${feature.name}] Config key "${keyName}" has piiEncrypted=true but type="${keyDef.type}" — piiEncrypted only applies to text keys. Use type="text" or remove piiEncrypted.`,
      });
    }

    // system scope has no subject (no tenant, no user) for the subject-KMS
    // to encrypt under.
    if (keyDef.scope === "system") {
      throw bootRuleError(CONFIG_KEY_RULES.piiEncryptedSystemScope, {
        message: `[Feature ${feature.name}] Config key "${keyName}" has piiEncrypted=true but scope="system" — system-scope has no subject (tenant/user) for the subject-KMS to encrypt under. Use scope="tenant" or "user", or remove piiEncrypted.`,
      });
    }

    // Mutually exclusive with the shared-cipher path: a config value is
    // either subject-keyed (piiEncrypted) or master-key-keyed (encrypted/
    // backing="secrets"), never both — unlike entity fields, which allow
    // both markers together (double-wrap, e.g. auth-mfa.totpSecret) because
    // entity rows decrypt through a fixed executor pipeline that peels both
    // layers. Config values have no such pipeline; picking one keeps the
    // resolver simple.
    if (isEncryptedAtRest(keyDef)) {
      throw bootRuleError(CONFIG_KEY_RULES.piiEncryptedAndEncrypted, {
        message: `[Feature ${feature.name}] Config key "${keyName}" has both piiEncrypted=true and encrypted/backing="secrets" — pick one: piiEncrypted (subject-KMS, user-visible) or encrypted (shared cipher, server-only values)`,
      });
    }
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
        throw bootRuleError(CONFIG_KEY_RULES.unknownConfigRead, {
          message: `Feature "${feature.name}" reads config "${key}" but no feature defines that key. Declare the key via r.config(...) in a feature, or fix the key name.`,
        });
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
      throw bootRuleError(CONFIG_KEY_RULES.circularDependency, {
        message: `Circular dependency: ${[...path, name].join(" → ")}. Break the cycle by removing one requires() link.`,
      });
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
