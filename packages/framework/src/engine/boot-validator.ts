import type { FeatureDefinition } from "./types";

const FILE_FIELD_TYPES = new Set(["file", "image", "files", "images"]);

/**
 * Validates all feature configurations at boot time.
 * Throws on the first error found — fail fast.
 */
export function validateBoot(features: readonly FeatureDefinition[]): void {
  const featureMap = new Map<string, FeatureDefinition>();
  for (const f of features) {
    featureMap.set(f.name, f);
  }

  // Collect all extension names and their schema extensions
  const extensionProviders = new Map<string, string>();
  for (const f of features) {
    for (const extName of Object.keys(f.registrarExtensions)) {
      extensionProviders.set(extName, f.name);
    }
  }

  // Collect all config keys across features (for cross-feature reference validation)
  const allConfigKeys = new Set<string>();
  for (const f of features) {
    for (const key of Object.keys(f.configKeys)) {
      allConfigKeys.add(`${f.name}.${key}`);
    }
  }

  let hasEncryptedFields = false;
  let hasFileFields = false;

  for (const feature of features) {
    validateCircularDeps(feature.name, featureMap);
    if (validateEncryptedFields(feature)) hasEncryptedFields = true;
    if (validateFileFields(feature)) hasFileFields = true;
    validateEmbeddedFields(feature);
    validateTransitions(feature);
    validateExtensionUsages(feature, extensionProviders);
    validateExtendSchemaCollisions(feature);
    validateHandlerAccess(feature);
    validateLocatedTimestamps(feature);
    validateConfigKeyBounds(feature);
    validateConfigKeyComputed(feature);
    validateConfigKeyAllowPerRequest(feature);
  }

  if (hasEncryptedFields && !process.env["ENCRYPTION_KEY"]) {
    throw new Error("ENCRYPTION_KEY environment variable is required (encrypted fields in use)");
  }

  if (hasFileFields && !process.env["FILE_STORAGE_PROVIDER"]) {
    throw new Error(
      "FILE_STORAGE_PROVIDER environment variable is required (file/image fields in use)",
    );
  }

  validateConfigReads(features, allConfigKeys);
}

// --- Config key bounds consistency ---

function validateConfigKeyBounds(feature: FeatureDefinition): void {
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
      const defaultNum = keyDef.default as number;
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

function validateConfigKeyComputed(feature: FeatureDefinition): void {
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

// --- Config key allowPerRequest compatibility ---

function validateConfigKeyAllowPerRequest(feature: FeatureDefinition): void {
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

// --- Config key cross-feature reference validation ---

function validateConfigReads(
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

function validateCircularDeps(
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

// --- Handler access validation ---

// Every handler must declare access. Missing access is treated as default-deny
// at runtime, but we fail at boot to turn an easy-to-miss security regression
// into a loud configuration error.
function validateHandlerAccess(feature: FeatureDefinition): void {
  for (const [name, handler] of Object.entries(feature.writeHandlers)) {
    if (!handler.access) {
      throw new Error(
        `Write handler "${feature.name}:write:${name}" is missing an access rule. ` +
          `Set { roles: [...] } for role-based access, or { openToAll: true } for any authenticated user.`,
      );
    }
  }
  for (const [name, handler] of Object.entries(feature.queryHandlers)) {
    if (!handler.access) {
      throw new Error(
        `Query handler "${feature.name}:query:${name}" is missing an access rule. ` +
          `Set { roles: [...] } for role-based access, or { openToAll: true } for any authenticated user.`,
      );
    }
  }
}

// --- Located-Timestamp validation ---
//
// Wenn ein Feld `type: "timestamp"` einen `locatedBy`-Marker trägt, muss das
// referenzierte Feld in derselben Entity existieren UND vom Typ `tz` sein.
// Sonst weiß weder DB-Wrapper noch JSON-Serializer welche TZ zur Wall-Clock
// gehört → silent data loss bei Reads in anderer Server-TZ.
//
// Die häufigste Quelle von Konflikten ist Hand-Konstruktion:
//   { foo: { type: "timestamp", locatedBy: "fooTz" } }
// ohne das `fooTz`-Feld zu deklarieren. Der `locatedTimestamp(name)` Helper
// macht das Pair atomar — wer ihn nutzt, fliegt nicht durch diesen Validator.
function validateLocatedTimestamps(feature: FeatureDefinition): void {
  for (const [entityName, entity] of Object.entries(feature.entities)) {
    const fields = entity.fields;
    for (const [fieldName, field] of Object.entries(fields)) {
      if (field.type !== "timestamp" || field.locatedBy === undefined) continue;
      const referenced = fields[field.locatedBy];
      if (!referenced) {
        throw new Error(
          `Feature "${feature.name}", entity "${entityName}": field "${fieldName}" has ` +
            `locatedBy: "${field.locatedBy}" but no field with that name exists in the entity. ` +
            `Either declare the tz-field, or use the locatedTimestamp("${fieldName.replace(/At$/, "")}") helper ` +
            `to create the pair atomically.`,
        );
      }
      if (referenced.type !== "tz") {
        throw new Error(
          `Feature "${feature.name}", entity "${entityName}": field "${fieldName}" has ` +
            `locatedBy: "${field.locatedBy}" but that field is type "${referenced.type}", ` +
            `expected "tz". The locatedBy marker must point to a tz-field (IANA-zone slot).`,
        );
      }
    }
  }
}

// --- Encrypted field validation ---

function validateEncryptedFields(feature: FeatureDefinition): boolean {
  let found = false;
  for (const [entityName, entity] of Object.entries(feature.entities)) {
    for (const [fieldName, field] of Object.entries(entity.fields)) {
      if (field.type !== "text") continue;
      if (!field.encrypted) continue;
      found = true;

      if (field.searchable) {
        throw new Error(
          `Field "${fieldName}" on entity "${entityName}" cannot be both encrypted and searchable`,
        );
      }
      if (field.sortable) {
        throw new Error(
          `Field "${fieldName}" on entity "${entityName}" cannot be both encrypted and sortable`,
        );
      }
    }
  }
  return found;
}

// --- File field detection ---

function validateFileFields(feature: FeatureDefinition): boolean {
  for (const entity of Object.values(feature.entities)) {
    for (const field of Object.values(entity.fields)) {
      if (FILE_FIELD_TYPES.has(field.type)) return true;
    }
  }
  return false;
}

// --- Extension usage validation ---

function validateExtensionUsages(
  feature: FeatureDefinition,
  extensionProviders: ReadonlyMap<string, string>,
): void {
  for (const usage of feature.extensionUsages) {
    const providerFeature = extensionProviders.get(usage.extensionName);
    if (!providerFeature) {
      throw new Error(
        `Feature "${feature.name}" uses extension "${usage.extensionName}" on entity "${usage.entityName}" but no feature defines that extension`,
      );
    }

    const allDeps = [...feature.requires, ...feature.optionalRequires];
    if (!allDeps.includes(providerFeature)) {
      throw new Error(
        `Feature "${feature.name}" uses extension "${usage.extensionName}" but missing requires("${providerFeature}")`,
      );
    }
  }
}

// --- Embedded field validation ---

const VALID_EMBEDDED_SUB_TYPES = new Set(["text", "number", "boolean", "date"]);

function validateEmbeddedFields(feature: FeatureDefinition): void {
  for (const [entityName, entity] of Object.entries(feature.entities)) {
    for (const [fieldName, field] of Object.entries(entity.fields)) {
      if (field.type !== "embedded") continue;

      if (!field.schema || Object.keys(field.schema).length === 0) {
        throw new Error(
          `Embedded field "${fieldName}" on entity "${entityName}" in feature "${feature.name}" has an empty schema`,
        );
      }

      for (const [subName, subField] of Object.entries(field.schema)) {
        if (!VALID_EMBEDDED_SUB_TYPES.has(subField.type)) {
          throw new Error(
            `Embedded field "${fieldName}.${subName}" on entity "${entityName}" has invalid type "${subField.type}". Allowed: ${[...VALID_EMBEDDED_SUB_TYPES].join(", ")}`,
          );
        }
      }
    }
  }
}

// --- Transition validation ---

function validateTransitions(feature: FeatureDefinition): void {
  for (const [entityName, entity] of Object.entries(feature.entities)) {
    if (!entity.transitions) continue;

    for (const [fieldName, transitionMap] of Object.entries(entity.transitions)) {
      const field = entity.fields[fieldName];

      if (!field) {
        throw new Error(
          `Transitions defined for unknown field "${fieldName}" on entity "${entityName}" in feature "${feature.name}"`,
        );
      }

      if (field.type !== "select") {
        throw new Error(
          `Transitions defined for field "${fieldName}" on entity "${entityName}" but field type is "${field.type}" (must be "select")`,
        );
      }

      const validOptions = new Set(field.options);

      // Check all states in the transition map
      for (const [from, targets] of Object.entries(transitionMap)) {
        if (!validOptions.has(from)) {
          throw new Error(
            `Transition state "${from}" on "${entityName}.${fieldName}" is not a valid option. Valid: ${[...validOptions].join(", ")}`,
          );
        }
        for (const to of targets) {
          if (!validOptions.has(to)) {
            throw new Error(
              `Transition target "${to}" (from "${from}") on "${entityName}.${fieldName}" is not a valid option. Valid: ${[...validOptions].join(", ")}`,
            );
          }
        }
      }
    }
  }
}

// --- extendSchema column collision detection ---

function validateExtendSchemaCollisions(feature: FeatureDefinition): void {
  for (const [entityName, entity] of Object.entries(feature.entities)) {
    const existingFields = new Set(Object.keys(entity.fields));

    // Check if any registered extension would collide with existing fields
    for (const ext of Object.values(feature.registrarExtensions)) {
      if (!ext.extendSchema) continue;
      const extraFields = ext.extendSchema(entityName);
      for (const fieldName of Object.keys(extraFields)) {
        if (existingFields.has(fieldName)) {
          throw new Error(
            `extendSchema column "${fieldName}" conflicts with existing field on entity "${entityName}"`,
          );
        }
      }
    }
  }
}
