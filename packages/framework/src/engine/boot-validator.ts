import type { OwnershipMap, OwnershipRule } from "./ownership";
import { qualifyEntityName } from "./qualified-name";
import type { ClaimKeyDefinition, FeatureDefinition, NavDefinition } from "./types";
import { normalizeEditField, normalizeListColumn } from "./types/screen";

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

  // Collect all claim keys — the ownership-rule validator below resolves
  // `from("claim:<feature>:<key>")` strings against this map. Qualified name
  // is how the resolver / readClaim / ownership system all reference claims,
  // so we key on the qualifiedName here too.
  const allClaimKeys = new Map<string, ClaimKeyDefinition>();
  for (const f of features) {
    for (const def of Object.values(f.claimKeys)) {
      allClaimKeys.set(def.qualifiedName, def);
    }
  }

  // Cross-feature role set — derived from handler-access rules + framework
  // built-ins ("all", "system"). We don't have a dedicated role-registry
  // (r.defineRoles is a type-level helper, not a runtime export), so we
  // use "referenced in any handler access rule" as the corpus of known
  // roles. The ownership-validator checks OwnershipMap keys + legacy
  // string[] field-access entries against this set — typos like "Admi"
  // instead of "Admin" fail at boot if nothing else ever mentions "Admi".
  const knownRoles = collectKnownRoles(features);

  // Cross-feature screen + nav registry — built once up front so per-feature
  // validators can check nav-ref targets + parent chains without re-scanning
  // every feature's navs map.
  const allScreenQns = collectScreenQns(features);
  const allNavQns = collectNavQns(features);

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
    validateOwnershipRules(feature, allClaimKeys, knownRoles);
    validateMultiStreamProjections(feature);
    validateScreens(feature, featureMap);
    validateNavs(feature, allScreenQns, allNavQns);
  }

  validateNavCycles(allNavQns);

  if (hasEncryptedFields && !process.env["ENCRYPTION_KEY"]) {
    throw new Error("ENCRYPTION_KEY environment variable is required (encrypted fields in use)");
  }

  if (hasFileFields && !process.env["FILE_STORAGE_PROVIDER"]) {
    throw new Error(
      "FILE_STORAGE_PROVIDER environment variable is required (file/image fields in use)",
    );
  }

  validateConfigReads(features, allConfigKeys);
  warnOnToggleableDependencies(features, featureMap);
}

// --- Toggleable-dependency warnings ---
//
// When feature A declares r.requires("B") and B is toggleable with
// default=false, A is effectively disabled out-of-the-box until someone
// flips B on globally. That's usually an oversight — the dev either meant
// optionalRequires, or forgot to ship B with default=true. We warn (not
// fail) because the combination is legal: an app might intentionally
// require an opt-in feature to make it explicit that B must be activated.
function warnOnToggleableDependencies(
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

// --- MultiStreamProjection delivery-invariant ---
//
// `delivery: "per-instance"` mit einer `table` ist eine semantische Falle:
// N Dispatcher-Instanzen würden parallel die gleichen INSERT/UPDATE-Zeilen
// schreiben (Race / Duplicates), und ein Rebuild würde nur eine Zeile in
// kumiko_event_consumers anfassen (die SHARED_INSTANCE_SENTINEL-Zeile),
// während Live-Cursor in per-instance-Zeilen liegen → Cursor-Divergenz.
//
// Die Invariante ist: per-instance-Consumer sind rein side-effect (SSE,
// in-memory cache invalidation). Wer eine Tabelle materialisiert, braucht
// shared delivery — das ist exactly-once globally und gibt dem Rebuild
// einen einzigen Cursor zum zurücksetzen.
function validateMultiStreamProjections(feature: FeatureDefinition): void {
  for (const [name, msp] of Object.entries(feature.multiStreamProjections)) {
    if (msp.delivery === "per-instance" && msp.table !== undefined) {
      throw new Error(
        `[Feature ${feature.name}] MultiStreamProjection "${name}" has delivery="per-instance" AND a backing table — ` +
          `that combination would make every dispatcher-instance write the same rows (duplicate INSERTs), and rebuild would reset only the shared cursor while live cursors live per-instance (cursor divergence). ` +
          `Use delivery="shared" (default) for table-materializing projections, or drop the table for side-effect-only consumers (SSE, in-memory caches).`,
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

// --- Ownership rule validation (H.2) ---
//
// Walks every entity.access and every field.access map, resolves each
// FromRule against the cross-feature claim registry, and confirms the
// referenced column exists on the entity. Catches typos, renames, and
// cross-feature-claim-removal scenarios at boot instead of at request time.

function validateOwnershipRules(
  feature: FeatureDefinition,
  allClaimKeys: ReadonlyMap<string, ClaimKeyDefinition>,
  knownRoles: ReadonlySet<string>,
): void {
  for (const [entityName, entity] of Object.entries(feature.entities)) {
    const columnNames = new Set<string>(Object.keys(entity.fields));
    // Framework-managed columns that rules are allowed to reference too.
    // These are the base columns buildDrizzleTable adds unconditionally.
    const frameworkColumns = ["id", "tenantId", "version", "insertedAt", "modifiedAt"];
    for (const col of frameworkColumns) columnNames.add(col);

    // Entity-level access
    if (entity.access?.read) {
      checkOwnershipMap({
        map: entity.access.read,
        columnNames,
        allClaimKeys,
        knownRoles,
        scope: `entity "${entityName}".access.read`,
        featureName: feature.name,
      });
    }
    if (entity.access?.write) {
      checkOwnershipMap({
        map: entity.access.write,
        columnNames,
        allClaimKeys,
        knownRoles,
        scope: `entity "${entityName}".access.write`,
        featureName: feature.name,
      });
    }

    // Field-level access — OwnershipMap form goes through checkOwnershipMap,
    // legacy string[] through checkLegacyRoleList. Both enforce role-name
    // existence against knownRoles so typos fail loud.
    for (const [fieldName, field] of Object.entries(entity.fields)) {
      checkFieldAccess({
        access: field.access?.read,
        columnNames,
        allClaimKeys,
        knownRoles,
        scope: `${entityName}.${fieldName}.access.read`,
        featureName: feature.name,
      });
      checkFieldAccess({
        access: field.access?.write,
        columnNames,
        allClaimKeys,
        knownRoles,
        scope: `${entityName}.${fieldName}.access.write`,
        featureName: feature.name,
      });
    }
  }
}

function checkFieldAccess(args: {
  readonly access: OwnershipMap | readonly string[] | undefined;
  readonly columnNames: ReadonlySet<string>;
  readonly allClaimKeys: ReadonlyMap<string, ClaimKeyDefinition>;
  readonly knownRoles: ReadonlySet<string>;
  readonly scope: string;
  readonly featureName: string;
}): void {
  // skip: no access rules on this field, nothing to validate
  if (!args.access) return;
  if (Array.isArray(args.access)) {
    // Legacy string[] form — every entry is a role name. Ref/column
    // validation is n/a here (no claim refs in this shape), but the
    // role-existence check applies.
    checkLegacyRoleList(
      args.access as readonly string[],
      args.knownRoles,
      args.scope,
      args.featureName,
    );
    // skip: legacy form validated, OwnershipMap check below doesn't apply
    return;
  }
  checkOwnershipMap({
    map: args.access as OwnershipMap,
    columnNames: args.columnNames,
    allClaimKeys: args.allClaimKeys,
    knownRoles: args.knownRoles,
    scope: args.scope,
    featureName: args.featureName,
  });
}

function checkLegacyRoleList(
  roles: readonly string[],
  knownRoles: ReadonlySet<string>,
  scope: string,
  featureName: string,
): void {
  // skip: no handler-declared roles in this app, role-validation disabled
  if (!shouldValidateRoles(knownRoles)) return;
  for (const roleName of roles) {
    if (!knownRoles.has(roleName)) {
      throw new Error(buildUnknownRoleMessage(roleName, knownRoles, scope, featureName));
    }
  }
}

// Only validate role-existence when at least one handler in the system has
// declared a non-builtin role. Apps that run entirely on openToAll +
// system-role handlers don't benefit from role-typo detection and would
// otherwise get false-positive errors on every OwnershipMap — their
// knownRoles corpus is empty beyond "all"/"system", so any app-defined
// role would flag as unknown.
function shouldValidateRoles(knownRoles: ReadonlySet<string>): boolean {
  for (const r of knownRoles) {
    if (r !== "all" && r !== "system") return true;
  }
  return false;
}

function checkOwnershipMap(args: {
  readonly map: OwnershipMap;
  readonly columnNames: ReadonlySet<string>;
  readonly allClaimKeys: ReadonlyMap<string, ClaimKeyDefinition>;
  readonly knownRoles: ReadonlySet<string>;
  readonly scope: string;
  readonly featureName: string;
}): void {
  for (const [roleName, rawRule] of Object.entries(args.map)) {
    // Role-existence check — typos like `{"Admi": "all"}` where no handler
    // or other map mentions "Admi" would otherwise silently grant nothing.
    // Skip when no app-defined roles exist anywhere (handler-less or
    // system-only apps — shouldValidateRoles returns false there).
    if (shouldValidateRoles(args.knownRoles) && !args.knownRoles.has(roleName)) {
      throw new Error(
        buildUnknownRoleMessage(roleName, args.knownRoles, args.scope, args.featureName),
      );
    }

    const rule = rawRule as OwnershipRule;
    if (rule === "all") continue;
    if (rule.kind === "where") continue; // escape hatch — feature author owns the SQL

    // FromRule — validate ref + column.
    if (rule.refKind === "claim") {
      // refPath is the qualified claim name ("feature:shortName").
      const claim = args.allClaimKeys.get(rule.refPath);
      if (!claim) {
        const known = [...args.allClaimKeys.keys()].sort().join(", ") || "(none)";
        throw new Error(
          `[Kumiko Ownership] ${args.scope} references unknown claim "${rule.refPath}" ` +
            `(role: "${roleName}", feature: "${args.featureName}"). ` +
            `Declare it via r.claimKey("...", { type: "..." }) in the owning feature. ` +
            `Known claims: ${known}`,
        );
      }
      // String-compatible columns accept string and string[] claims equally
      // (array → inArray). For other claim types we rely on the author
      // knowing the row-column shape; we can't introspect PG types without
      // the schema built. This is a best-effort ref-existence check.
    }

    if (!args.columnNames.has(rule.column)) {
      const known = [...args.columnNames].sort().join(", ");
      throw new Error(
        `[Kumiko Ownership] ${args.scope} references column "${rule.column}" ` +
          `which does not exist on the entity (role: "${roleName}", feature: ` +
          `"${args.featureName}"). Available columns: ${known}`,
      );
    }
  }
}

function buildUnknownRoleMessage(
  roleName: string,
  knownRoles: ReadonlySet<string>,
  scope: string,
  featureName: string,
): string {
  const known = [...knownRoles].sort().join(", ");
  return (
    `[Kumiko Ownership] ${scope} references unknown role "${roleName}" ` +
    `(feature: "${featureName}"). Roles are collected from handler access ` +
    `rules across all features plus the "all" and "system" built-ins; if ` +
    `"${roleName}" is real, make sure at least one handler declares ` +
    `access.roles: ["${roleName}"]. Known roles: ${known}`
  );
}

// --- Screen validation ---
//
// For every r.screen() declaration check what's locally knowable at boot:
//   - entityList / entityEdit: the referenced entity must exist in the
//     feature (cross-feature entity-refs aren't allowed — a feature owns
//     the screens over its own entities) and every column/field ref must
//     name a real field on that entity
//   - custom: the renderer must at least have one platform component set
//     (react OR native), otherwise the screen is structurally empty
//
// Field-level renderer QN strings (cross-feature `component:` references)
// are NOT validated here — the r.uiComponent registry that would resolve
// them ships in M4/M5. Until then those are kept opaque on purpose.
function validateScreens(
  feature: FeatureDefinition,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  for (const [screenId, screen] of Object.entries(feature.screens)) {
    if (screen.type === "custom") {
      if (!screen.renderer.react && !screen.renderer.native) {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" has type="custom" but the renderer ` +
            `declares neither a react nor a native component — at least one platform must be set.`,
        );
      }
      continue;
    }

    // entityList / entityEdit: entity-refs are feature-local.
    const entityDef = feature.entities[screen.entity];
    if (!entityDef) {
      const known = Object.keys(feature.entities).sort().join(", ") || "(none)";
      const crossFeature = findEntityFeature(screen.entity, featureMap);
      const hint = crossFeature
        ? ` Entity "${screen.entity}" is owned by feature "${crossFeature}" — cross-feature screen ownership is not supported.`
        : "";
      throw new Error(
        `[Feature ${feature.name}] Screen "${screenId}" references entity "${screen.entity}" ` +
          `which is not declared in this feature (known: ${known}).${hint}`,
      );
    }

    const fieldNames = new Set(Object.keys(entityDef.fields));
    if (screen.type === "entityList") {
      // Empty column list would render as a blank table — almost always the
      // sign of an in-progress screen the author forgot to fill in. Fail
      // loud: ui-core's computeListViewModel can't do anything useful with
      // zero columns either.
      if (screen.columns.length === 0) {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (entityList) has an empty columns list — ` +
            `declare at least one column.`,
        );
      }
      for (const col of screen.columns) {
        const normalized = normalizeListColumn(col);
        if (!fieldNames.has(normalized.field)) {
          throw new Error(
            buildUnknownFieldMessage(
              feature.name,
              screenId,
              normalized.field,
              screen.entity,
              fieldNames,
            ),
          );
        }
      }
    } else {
      // Same rationale as the columns check: an entityEdit layout with zero
      // sections (or sections without any fields) renders as nothing — reject
      // at boot so the author sees it before the blank form surprises them.
      if (screen.layout.sections.length === 0) {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (entityEdit) has an empty sections list — ` +
            `declare at least one section.`,
        );
      }
      for (const section of screen.layout.sections) {
        if (section.fields.length === 0) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (entityEdit) has a section "${section.title}" ` +
              `with zero fields — drop the section or add fields to it.`,
          );
        }
        for (const fieldSpec of section.fields) {
          const normalized = normalizeEditField(fieldSpec);
          if (!fieldNames.has(normalized.field)) {
            throw new Error(
              buildUnknownFieldMessage(
                feature.name,
                screenId,
                normalized.field,
                screen.entity,
                fieldNames,
              ),
            );
          }
        }
      }
    }
  }
}

function findEntityFeature(
  entityName: string,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): string | undefined {
  for (const [name, feature] of featureMap) {
    if (feature.entities[entityName]) return name;
  }
  return undefined;
}

function buildUnknownFieldMessage(
  featureName: string,
  screenId: string,
  fieldName: string,
  entityName: string,
  knownFields: ReadonlySet<string>,
): string {
  const known = [...knownFields].sort().join(", ");
  return (
    `[Feature ${featureName}] Screen "${screenId}" references field "${fieldName}" ` +
    `which does not exist on entity "${entityName}" (known: ${known}).`
  );
}

// --- Nav validation ---
//
// The boot-validator runs BEFORE createRegistry builds the final maps, so we
// pre-build the qualified name sets for screens + navs here. `qualifyEntityName`
// is the shared helper with the registry — changing the qualification rule
// in one place flows through both ingest paths.

function collectScreenQns(features: readonly FeatureDefinition[]): Set<string> {
  const set = new Set<string>();
  for (const f of features) {
    for (const screenId of Object.keys(f.screens)) {
      set.add(qualifyEntityName(f.name, "screen", screenId));
    }
  }
  return set;
}

function collectNavQns(
  features: readonly FeatureDefinition[],
): Map<string, NavDefinition & { readonly featureName: string }> {
  const map = new Map<string, NavDefinition & { readonly featureName: string }>();
  for (const f of features) {
    for (const [navId, navDef] of Object.entries(f.navs)) {
      const qualified = qualifyEntityName(f.name, "nav", navId);
      map.set(qualified, { ...navDef, featureName: f.name });
    }
  }
  return map;
}

// Per-feature ref validation: screen + parent refs point at real QNs. Cycle
// detection runs once globally afterwards (it's cheaper to do a single DFS
// over the merged graph than restart it per feature).
function validateNavs(
  feature: FeatureDefinition,
  allScreenQns: ReadonlySet<string>,
  allNavQns: ReadonlyMap<string, NavDefinition & { readonly featureName: string }>,
): void {
  for (const [navId, navDef] of Object.entries(feature.navs)) {
    if (navDef.screen !== undefined && !allScreenQns.has(navDef.screen)) {
      throw new Error(
        `[Feature ${feature.name}] Nav entry "${navId}" references screen "${navDef.screen}" ` +
          `which is not registered. Expected a qualified name of the form ` +
          `"<feature>:screen:<id>" pointing at an r.screen() declaration.`,
      );
    }
    if (navDef.parent !== undefined && !allNavQns.has(navDef.parent)) {
      throw new Error(
        `[Feature ${feature.name}] Nav entry "${navId}" references parent "${navDef.parent}" ` +
          `which is not a registered nav entry. Expected a qualified name of the form ` +
          `"<feature>:nav:<id>".`,
      );
    }
  }
}

// Walks parent-refs across ALL nav entries (cross-feature). A cycle here
// would crash client-side tree assembly — easier to fail loud at boot than
// to debug a React "Maximum update depth exceeded" stack trace.
function validateNavCycles(
  allNavQns: ReadonlyMap<string, NavDefinition & { readonly featureName: string }>,
): void {
  const visited = new Set<string>();
  const stack = new Set<string>();

  function visit(qualified: string, path: string[]): void {
    if (stack.has(qualified)) {
      throw new Error(
        `[Kumiko Nav] Nav entry parent cycle detected: ${[...path, qualified].join(" → ")}`,
      );
    }
    // skip: already visited — cycle-detection only needs to traverse each
    // node once, and the `stack` check above catches any actual cycles
    // reached via a different path.
    if (visited.has(qualified)) return;
    visited.add(qualified);
    stack.add(qualified);
    const navDef = allNavQns.get(qualified);
    if (navDef?.parent) {
      visit(navDef.parent, [...path, qualified]);
    }
    stack.delete(qualified);
  }

  for (const qualified of allNavQns.keys()) {
    visit(qualified, []);
  }
}

// Roles we recognise at boot time. The framework has no explicit
// role-registry (r.defineRoles is a type helper only), so we synthesise
// one from every handler-access rule plus the "all"/"system" built-ins.
function collectKnownRoles(features: readonly FeatureDefinition[]): Set<string> {
  const roles = new Set<string>(["all", "system"]);
  for (const f of features) {
    for (const def of Object.values(f.writeHandlers)) {
      if (def.access && "roles" in def.access) {
        for (const r of def.access.roles) roles.add(r);
      }
    }
    for (const def of Object.values(f.queryHandlers)) {
      if (def.access && "roles" in def.access) {
        for (const r of def.access.roles) roles.add(r);
      }
    }
  }
  return roles;
}
