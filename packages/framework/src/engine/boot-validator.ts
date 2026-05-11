import type { OwnershipMap, OwnershipRule } from "./ownership";
import { parseRefTarget } from "./parse-ref-target";
import { qualifyEntityName } from "./qualified-name";
import { getAllowedFilterOps, isFieldFilterable } from "./screen-filter-ops";
import type {
  ClaimKeyDefinition,
  FeatureDefinition,
  NavDefinition,
  WorkspaceDefinition,
} from "./types";
import type { PiiAnnotations } from "./types/fields";
import { normalizeEditField, normalizeListColumn } from "./types/screen";

const FILE_FIELD_TYPES = new Set(["file", "image", "files", "images"]);

// Field-Namen die typischerweise PII enthalten. Ohne `pii: true` /
// `userOwned` / `tenantOwned` / `allowPlaintext`-Marker → Boot-Warning.
// Lower-case compare für case-insensitive Match (displayName vs displayname).
//
// Bewusst NICHT in der Liste:
//   - `name` allein — zu viele Geschäfts-Kontexte (product.name,
//     tenant.name, role.name) sind kein PII. Personen-Namen werden
//     ueber displayName / firstName / lastName / fullName erfasst.
//
// Quelle: docs/plans/datenschutz/crypto-shredding.md Boot-Validation-Sektion.
const PII_DIRECT_NAME_HINTS: ReadonlySet<string> = new Set([
  "email",
  "phone",
  "phonenumber",
  "mobile",
  "address",
  "street",
  "postalcode",
  "zipcode",
  "zip",
  "city",
  "displayname",
  "firstname",
  "lastname",
  "fullname",
  "birthday",
  "birthdate",
  "dateofbirth",
  "dob",
  "ssn",
  "taxid",
  "vatid",
  "passport",
  "iban",
  "bic",
]);

// Field-Namen die typischerweise User-Generated-Content enthalten —
// User-Forget muss diese mit Author-Subject-Key encrypten.
const PII_USER_OWNED_NAME_HINTS: ReadonlySet<string> = new Set([
  "body",
  "text",
  "content",
  "message",
  "comment",
  "description",
  "note",
  "notes",
]);

// Framework-managed Timestamp-Spalten — dürfen als retention.reference
// genutzt werden auch wenn nicht in entity.fields deklariert.
const FRAMEWORK_TIMESTAMP_FIELDS: ReadonlySet<string> = new Set([
  "createdAt",
  "updatedAt",
  "lastSeenAt",
  "deletedAt",
]);

// Erlaubtes Format fuer retention.keepFor — Zahlen + Suffix (h/d/w/m/y).
// Echtes Parsen kommt mit dem Cleanup-Job in Sprint 2; Boot-Validator
// macht nur den Sanity-Check damit Tippfehler ("30days") frueh sichtbar
// werden statt erst beim ersten Cleanup-Run.
const KEEP_FOR_PATTERN = /^\d+[hdwmy]$/;

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
  // Qualified config-key set für ConfigEditScreen-Validation. Format
  // wie in registry.ts: `<feature>:config:<short>`. allConfigKeys oben
  // nutzt das ältere `feature.short`-Format für validateConfigReads.
  const allConfigKeyQns = new Set<string>();
  for (const f of features) {
    for (const key of Object.keys(f.configKeys)) {
      allConfigKeys.add(`${f.name}.${key}`);
      allConfigKeyQns.add(`${f.name}:config:${key}`);
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
  const allWorkspaceQns = collectWorkspaceQns(features);
  const allWriteHandlerQns = collectWriteHandlerQns(features);

  // Cross-feature API exposure-map — jedes Feature deklariert Marker via
  // r.exposesApi(name). Per-feature validateApiExposureMatching walkt
  // usedApis-Set und checkt dass jeder Eintrag hier einen Match findet.
  // Verhindert dass typo-getroffene oder gedroppte QN-Aufrufe zu
  // Runtime-Crash statt Boot-Fail werden.
  const allExposedApis = new Map<string, string>(); // apiName → providerFeature
  for (const f of features) {
    for (const apiName of f.exposedApis) {
      const existing = allExposedApis.get(apiName);
      if (existing && existing !== f.name) {
        throw new Error(
          `Cross-feature API "${apiName}" exposed by both "${existing}" and "${f.name}" — API names must be globally unique.`,
        );
      }
      allExposedApis.set(apiName, f.name);
    }
  }

  let hasEncryptedFields = false;
  let hasFileFields = false;

  for (const feature of features) {
    validateCircularDeps(feature.name, featureMap);
    if (validateEncryptedFields(feature)) hasEncryptedFields = true;
    if (validateFileFields(feature)) hasFileFields = true;
    validatePiiAndRetention(feature);
    validateApiExposureMatching(feature, allExposedApis, featureMap);
    validateEmbeddedFields(feature);
    validateMultiSelectFields(feature);
    validateReferenceFields(feature, featureMap);
    validateTransitions(feature);
    validateExtensionUsages(feature, extensionProviders);
    validateExtendSchemaCollisions(feature);
    validateHandlerAccess(feature);
    validateLocatedTimestamps(feature);
    validateEntityIndexes(feature);
    validateConfigKeyBounds(feature);
    validateConfigKeyComputed(feature);
    validateConfigKeyAllowPerRequest(feature);
    validateOwnershipRules(feature, allClaimKeys, knownRoles);
    validateMultiStreamProjections(feature);
    validateScreens(feature, featureMap, allWriteHandlerQns, allScreenQns, allConfigKeyQns);
    validateNavs(feature, allScreenQns, allNavQns, allWorkspaceQns);
    validateWorkspaces(feature, allNavQns);
  }

  validateNavCycles(allNavQns);
  validateDefaultWorkspaceUniqueness(allWorkspaceQns);

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

// Rate-limit modes that bucket per user.id. Anonymous endpoints would put
// every unauthenticated caller into a single shared bucket (id="anonymous"),
// turning the rate-limit into a global tap any caller can drain. Boot-fail
// before the misconfiguration ships.
const USER_BUCKETED_RATE_LIMIT_PER: ReadonlySet<string> = new Set(["user", "user+handler"]);

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
    validateAnonymousRateLimit(feature.name, "write", name, handler.access, handler.rateLimit);
  }
  for (const [name, handler] of Object.entries(feature.queryHandlers)) {
    if (!handler.access) {
      throw new Error(
        `Query handler "${feature.name}:query:${name}" is missing an access rule. ` +
          `Set { roles: [...] } for role-based access, or { openToAll: true } for any authenticated user.`,
      );
    }
    validateAnonymousRateLimit(feature.name, "query", name, handler.access, handler.rateLimit);
  }
}

function validateAnonymousRateLimit(
  featureName: string,
  kind: "write" | "query",
  handlerName: string,
  access: NonNullable<FeatureDefinition["writeHandlers"][string]["access"]>,
  rateLimit: FeatureDefinition["writeHandlers"][string]["rateLimit"],
): void {
  // skip: handler doesn't opt into rate-limit, no user-bucket risk
  if (!rateLimit) return;
  // skip: openToAll handlers don't allow anonymous (hasAccess rejects), so
  // the user-bucket footgun doesn't apply
  if (!("roles" in access)) return;
  // skip: handler doesn't list anonymous, regular role-rate-limit is fine
  if (!access.roles.includes("anonymous")) return;
  // skip: rate-limit is already keyed on something safe (ip / tenant)
  if (!USER_BUCKETED_RATE_LIMIT_PER.has(rateLimit.per)) return;
  throw new Error(
    `${kind} handler "${featureName}:${kind}:${handlerName}" allows anonymous callers but uses ` +
      `rateLimit.per="${rateLimit.per}" — every anonymous request shares user.id="anonymous", ` +
      `so this bucket would be a single global tap any caller could drain. ` +
      `Use rateLimit.per="ip" or "ip+handler" for anonymous endpoints.`,
  );
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

// --- Entity-Index validation ---
//
// entity.indexes deklariert Composite-/Unique-Indices über mehrere Feld-
// Spalten. Häufige Fehler: Tippfehler im Feld-Namen, leere column-Liste,
// Index auf einem Field das die DB-Spalte gar nicht existiert (file/image
// in der multi-Variante). Catched at boot, lange bevor drizzle-kit beim
// generate-Run zickt.
//
// `tenantId` als einzige Spalte ist redundant — buildDrizzleTable legt
// den Index sowieso automatisch an. Wir lassen die Composite-Form erlaubt
// (`["tenantId", "key"]` ist sinnvoll), nur die rein-tenantId-Single-
// column-Form blockieren wir.
function validateEntityIndexes(feature: FeatureDefinition): void {
  for (const [entityName, entity] of Object.entries(feature.entities)) {
    if (!entity.indexes) continue;
    const fieldNames = new Set(Object.keys(entity.fields));
    for (const [idx, def] of entity.indexes.entries()) {
      const where = `Feature "${feature.name}", entity "${entityName}", indexes[${idx}]`;
      if (def.columns.length === 0) {
        throw new Error(`${where}: empty columns list. An index needs at least one column.`);
      }
      for (const col of def.columns) {
        if (col === "tenantId" || col === "id" || col === "version") continue; // base columns
        if (!fieldNames.has(col)) {
          throw new Error(
            `${where}: column "${col}" does not match any field in the entity. ` +
              `Available fields: ${[...fieldNames].join(", ")}.`,
          );
        }
        const field = entity.fields[col];
        if (
          field &&
          (field.type === "files" ||
            field.type === "images" ||
            (field.type === "reference" && field.multiple === true))
        ) {
          throw new Error(
            `${where}: column "${col}" is a multi-value field (${field.type}) — ` +
              `these have no DB column to index on. Use a single-value field or remove from the index.`,
          );
        }
        if (field && field.type === "longText") {
          // longText ist semantisch "potentially-megabytes content" — ein
          // BTREE-Index auf einer 1-MB-Spalte ist Performance-Disaster
          // (PG würde in TOAST-pages dereferenzieren müssen für jeden
          // Index-Lookup). Konsistent mit der type-level-decision dass
          // longText kein sortable/searchable/filterable hat. Wer
          // wirklich indexieren will, nimmt `text` mit den
          // entsprechenden Skalierungs-Trade-offs.
          throw new Error(
            `${where}: column "${col}" is a longText field — these cannot be indexed. ` +
              `Use \`text\` if you need indexing, or rely on the SearchAdapter (Meilisearch) for full-text search on long content.`,
          );
        }
      }
      if (def.columns.length === 1 && def.columns[0] === "tenantId") {
        throw new Error(
          `${where}: single-column index on "tenantId" is redundant — ` +
            `buildDrizzleTable always creates one automatically. Remove this entry.`,
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
      // Beide string-typed fields können encrypted sein. Die
      // searchable/sortable-Konflikt-Checks gelten nur für `text`
      // (longText hat diese flags type-level nicht).
      if (field.type !== "text" && field.type !== "longText") continue;
      if (!field.encrypted) continue;
      found = true;

      if (field.type === "text") {
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

// --- PII / Subject-Key Annotations + Retention validation ---
//
// Drei Klassen von Checks:
//
// 1. Mutual exclusion: pro Field nur EINE der drei Subject-Annotations
//    (pii / userOwned / tenantOwned). Mehr ist semantisch widersprüchlich
//    weil pro Field genau ein Subject-Key gehört.
//
// 2. Reference-Integrity: userOwned.ownerField muss auf ein existierendes
//    reference-Field zeigen (das auf user-Entity zeigen sollte). Erkennt
//    Tippfehler und Drop-Refactorings beim Boot statt beim ersten
//    Encrypt-Aufruf.
//
// 3. Heuristik-Warnings: Field-Namen die typischerweise PII enthalten
//    (email, name, phone, body, etc.) ohne Annotation → Boot-Warning.
//    Mit `allowPlaintext: "<reason>"` unterdrückbar (geht in Audit).
//
// 4. Retention-Integrity: retention.reference (wenn gesetzt) muss auf
//    ein bestehendes Field zeigen (oder Framework-Timestamp). retention.
//    strategy="blockDelete" ohne anonymize-Felder ist sinnlos — User-
//    Forget kann nichts machen, Warning.
//
// Encrypt/Decrypt-Mechanik landet in Sprint 3 (crypto-shredding); diese
// Validation greift schon ab Sprint 0 damit Schema-Drift früh auffällt.
function validatePiiAndRetention(feature: FeatureDefinition): void {
  for (const [entityName, entity] of Object.entries(feature.entities)) {
    const fieldsByName = entity.fields;

    for (const [fieldName, field] of Object.entries(fieldsByName)) {
      // PiiAnnotations-Properties sind type-level optional. Auf Field-
      // Defs die nicht via "& PiiAnnotations" erweitert sind (Boolean,
      // Money, Reference, Embedded, Tz, LocatedTimestamp, File*, Image*)
      // liefert property-access undefined zur Runtime. Die TS-Compile-
      // Time-Validation hat dort schon abgelehnt → Cast ist safe.
      const annot = field as PiiAnnotations;

      const hasPii = Boolean(annot.pii);
      const hasUserOwned = Boolean(annot.userOwned);
      const hasTenantOwned = Boolean(annot.tenantOwned);
      const annotCount = (hasPii ? 1 : 0) + (hasUserOwned ? 1 : 0) + (hasTenantOwned ? 1 : 0);

      if (annotCount > 1) {
        throw new Error(
          `[Feature ${feature.name}] Field "${fieldName}" on entity "${entityName}" has multiple subject-key annotations (pii / userOwned / tenantOwned). Pick one — each field belongs to exactly one subject.`,
        );
      }

      if (annot.userOwned) {
        const ownerName = annot.userOwned.ownerField;
        if (!ownerName || typeof ownerName !== "string") {
          throw new Error(
            `[Feature ${feature.name}] Field "${fieldName}" on entity "${entityName}" has userOwned without ownerField name`,
          );
        }
        const ownerField = fieldsByName[ownerName];
        if (!ownerField) {
          const known = Object.keys(fieldsByName).sort().join(", ");
          throw new Error(
            `[Feature ${feature.name}] Field "${fieldName}" on entity "${entityName}" references userOwned.ownerField "${ownerName}" but no such field exists. Known fields: ${known}`,
          );
        }
        if (ownerField.type !== "reference") {
          throw new Error(
            `[Feature ${feature.name}] userOwned.ownerField "${ownerName}" on entity "${entityName}" must be a reference field, got type "${ownerField.type}"`,
          );
        }
        // Soft-Warning wenn das reference-target nicht offensichtlich user
        // ist — custom subject-entities (HR-Mitarbeiter, Patient) sind
        // erlaubt, müssen aber bewusste Wahl sein.
        const refTarget = ownerField.entity;
        const targetEntity = refTarget.includes(":") ? refTarget.split(":")[1] : refTarget;
        if (targetEntity !== "user") {
          // biome-ignore lint/suspicious/noConsole: boot-time dev hint, no logger available yet
          console.warn(
            `[kumiko:boot] [Feature ${feature.name}] userOwned.ownerField "${ownerName}" on entity "${entityName}" targets reference "${refTarget}" — typically should be a user reference. If intentional (custom subject-entity like employee/patient), ignore.`,
          );
        }
      }

      // PII-Heuristik: nur wenn keine Annotation gesetzt UND kein
      // allowPlaintext-Marker. Ergibt false positives auf Geschäftsdaten
      // mit personenartigem Namen (z.B. company.legalName) — Author
      // unterdrückt mit { allowPlaintext: "is-business-data" }.
      const noAnnotation = annotCount === 0 && !annot.allowPlaintext;
      if (noAnnotation) {
        const lower = fieldName.toLowerCase();
        if (PII_DIRECT_NAME_HINTS.has(lower)) {
          // biome-ignore lint/suspicious/noConsole: boot-time dev hint, no logger available yet
          console.warn(
            `[kumiko:boot] [Feature ${feature.name}] Field "${fieldName}" on entity "${entityName}" has a PII-typical name but no { pii: true } annotation. If this is PII, mark it. If business data, set { allowPlaintext: "is-business-data" } to silence.`,
          );
        } else if (PII_USER_OWNED_NAME_HINTS.has(lower)) {
          // biome-ignore lint/suspicious/noConsole: boot-time dev hint, no logger available yet
          console.warn(
            `[kumiko:boot] [Feature ${feature.name}] Field "${fieldName}" on entity "${entityName}" has a user-content-typical name but no { userOwned } annotation. If this contains user-generated content, mark it { userOwned: { ownerField: "<authorIdField>" }}. If business data, set { allowPlaintext: "..." } to silence.`,
          );
        }
      }
    }

    // --- Entity-level retention ---
    const retention = entity.retention;
    if (retention) {
      if (!KEEP_FOR_PATTERN.test(retention.keepFor)) {
        // biome-ignore lint/suspicious/noConsole: boot-time dev hint, no logger available yet
        console.warn(
          `[kumiko:boot] [Feature ${feature.name}] Entity "${entityName}" retention.keepFor="${retention.keepFor}" hat ungueltiges Format. Erwartet: <Zahl><h|d|w|m|y> (z.B. "30d", "10y", "6m"). Cleanup-Job (Sprint 2) wird das nicht parsen koennen.`,
        );
      }

      if (retention.reference !== undefined) {
        const refName = retention.reference;
        if (!fieldsByName[refName] && !FRAMEWORK_TIMESTAMP_FIELDS.has(refName)) {
          const known = Object.keys(fieldsByName).sort().join(", ");
          const framework = [...FRAMEWORK_TIMESTAMP_FIELDS].sort().join(", ");
          throw new Error(
            `[Feature ${feature.name}] Entity "${entityName}" retention.reference "${refName}" does not exist. Known fields: ${known} — framework-managed timestamps also accepted: ${framework}`,
          );
        }
      }

      if (retention.strategy === "blockDelete") {
        const hasAnonymize = Object.values(fieldsByName).some((f) => {
          const a = f as PiiAnnotations;
          return Boolean(a.anonymize);
        });
        if (!hasAnonymize) {
          // biome-ignore lint/suspicious/noConsole: boot-time dev hint, no logger available yet
          console.warn(
            `[kumiko:boot] [Feature ${feature.name}] Entity "${entityName}" retention.strategy="blockDelete" but no field has an anonymize-function. User-Forget cannot anonymize — Forget will return error. Add { anonymize: () => null } or () => "[ANONYMIZED]" to PII fields.`,
          );
        }
      }
    }
  }
}

// --- Cross-feature API exposure / usage matching ---
//
// `r.exposesApi(name, impl)` registers a callable; `r.usesApi(name)`
// declares a caller. Boot-Validator prüft drei Invarianten:
//   1. Jeder usesApi(name) findet einen exposesApi(name) in irgendeinem
//      Feature.
//   2. Das exposing-Feature ist in requires/optionalRequires des callers
//      gelisted (sonst klappt die Cross-Feature-Aufruf-Reihenfolge nicht).
//   3. Self-exposure ist erlaubt (Feature ruft eigene API), wird aber
//      mit Warning markiert weil es typisch ein Refactor-Restbestand ist.
//
// Globale Eindeutigkeit der apiNames (kein Dublicate über Features)
// wird in validateBoot() vor dem Per-Feature-Walk geprüft.
function validateApiExposureMatching(
  feature: FeatureDefinition,
  allExposedApis: ReadonlyMap<string, string>,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  for (const apiName of feature.usedApis) {
    const providerFeature = allExposedApis.get(apiName);
    if (!providerFeature) {
      const known = [...allExposedApis.keys()].sort().join(", ") || "(none)";
      throw new Error(
        `[Feature ${feature.name}] r.usesApi("${apiName}") but no feature exposes that API. Known exposed APIs: ${known}`,
      );
    }

    if (providerFeature === feature.name) {
      // biome-ignore lint/suspicious/noConsole: boot-time dev hint, no logger available yet
      console.warn(
        `[kumiko:boot] [Feature ${feature.name}] r.usesApi("${apiName}") on its own r.exposesApi — typically a refactor leftover. Call the impl directly instead.`,
      );
      continue;
    }

    const allDeps = [...feature.requires, ...feature.optionalRequires];
    if (!allDeps.includes(providerFeature)) {
      throw new Error(
        `[Feature ${feature.name}] r.usesApi("${apiName}") is exposed by "${providerFeature}" but feature is not in requires/optionalRequires. Add r.requires("${providerFeature}").`,
      );
    }

    // Sanity: provider feature actually exists in this app's feature set.
    // Should always be true if allExposedApis was built from `features`,
    // aber defensiv für unklare Constructor-Pfade.
    if (!featureMap.has(providerFeature)) {
      throw new Error(
        `[Feature ${feature.name}] internal: r.usesApi("${apiName}") points to provider "${providerFeature}" which is not in feature map`,
      );
    }
  }
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

// Tier 2.7e-3 + Cross-Feature: ReferenceFieldDef-Validation.
//   1) referenced entity existiert (same-feature OR cross-feature
//      qualifiziert per "<feature>:<entity>"). Same-feature ist
//      Default; cross-feature verlangt expliziten ":"-Prefix.
//   2) labelField (wenn gesetzt) existiert auf der referenced Entity.
//   3) Self-Reference erlaubt (entity → entity).
//   4) Audit-Fix: Query-Handler `<feature>:query:<entity>:list` muss
//      registriert sein — der Renderer feuert den beim Combobox-
//      Open. Ohne Handler crasht die Combobox zur Laufzeit.
function validateReferenceFields(
  feature: FeatureDefinition,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  for (const [entityName, entity] of Object.entries(feature.entities)) {
    for (const [fieldName, field] of Object.entries(entity.fields)) {
      if (field.type !== "reference") continue;

      const target = parseRefTarget(field.entity, feature.name);
      const targetFeature = featureMap.get(target.featureName);
      if (!targetFeature) {
        const knownFeatures = [...featureMap.keys()].sort().join(", ");
        throw new Error(
          `[Feature ${feature.name}] Reference field "${fieldName}" on entity "${entityName}" ` +
            `targets unknown feature "${target.featureName}" via "${field.entity}". ` +
            `Known features: ${knownFeatures}.`,
        );
      }
      const targetEntity = targetFeature.entities[target.entityName];
      if (!targetEntity) {
        const known = Object.keys(targetFeature.entities).sort().join(", ") || "(none)";
        const where =
          target.featureName === feature.name
            ? `in this feature`
            : `in feature "${target.featureName}"`;
        throw new Error(
          `[Feature ${feature.name}] Reference field "${fieldName}" on entity "${entityName}" ` +
            `targets unknown entity "${target.entityName}" ${where}. ` +
            `Known entities: ${known}.`,
        );
      }
      if (field.labelField !== undefined) {
        const knownFields = Object.keys(targetEntity.fields);
        // "id" ist immer da, auch ohne Field-Definition (PK).
        if (field.labelField !== "id" && !knownFields.includes(field.labelField)) {
          throw new Error(
            `[Feature ${feature.name}] Reference field "${fieldName}" on entity "${entityName}" ` +
              `references labelField "${field.labelField}" which does not exist on entity ` +
              `"${target.entityName}". Known fields: ${[...knownFields, "id"].sort().join(", ")}.`,
          );
        }
      }
      // Audit-Fix #2: Query-Handler-Existenz pinnen. Renderer feuert
      // `<targetFeature>:query:<targetEntity>:list` beim Combobox-Open
      // (use-reference-lookup, ReferenceInput); ohne Handler kommt
      // beim ersten Klick ein 404. defaultEntityQueryHandler-Names
      // sind als kurz "<entity>:list" in feature.queryHandlers gespeichert.
      const expectedHandlerShortName = `${target.entityName}:list`;
      if (targetFeature.queryHandlers[expectedHandlerShortName] === undefined) {
        throw new Error(
          `[Feature ${feature.name}] Reference field "${fieldName}" on entity "${entityName}" ` +
            `targets entity "${target.entityName}" but no list-query-handler is registered ` +
            `there. Add r.queryHandler(defineEntityListHandler("${target.entityName}", ` +
            `${target.entityName}Entity)) to feature "${target.featureName}", or pick a ` +
            `different label/entity.`,
        );
      }
    }
  }
}

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

// --- MultiSelect field validation ---
//
// options muss non-empty sein (sonst wäre das Feld nicht benutzbar) und
// default — wenn gesetzt — ist eine Teilmenge der options. Beides würde
// auch im Zod-Schema bei runtime fehlschlagen, der Boot-Catch ist nur
// die früheste Stelle für klare Fehlermeldungen.
function validateMultiSelectFields(feature: FeatureDefinition): void {
  for (const [entityName, entity] of Object.entries(feature.entities)) {
    for (const [fieldName, field] of Object.entries(entity.fields)) {
      if (field.type !== "multiSelect") continue;

      if (field.options.length === 0) {
        throw new Error(
          `MultiSelect field "${fieldName}" on entity "${entityName}" in feature "${feature.name}" has empty options`,
        );
      }

      if (field.default !== undefined) {
        const validOptions = new Set<string>(field.options);
        for (const value of field.default) {
          if (!validOptions.has(value)) {
            throw new Error(
              `MultiSelect default "${value}" on "${entityName}.${fieldName}" is not a valid option. Valid: ${field.options.join(", ")}`,
            );
          }
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

    // @cast-boundary schema-walk — extracted from feature-config inspection
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
  allWriteHandlerQns: ReadonlySet<string>,
  allScreenQns: ReadonlySet<string>,
  allConfigKeyQns: ReadonlySet<string>,
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

    if (screen.type === "configEdit") {
      // configEdit: layout/fields wie actionForm validieren, plus
      // Cross-Check dass jeder qualifizierte Config-Key registriert
      // ist und der scope mit dem Key matcht.
      const fieldNames = new Set(Object.keys(screen.fields));
      if (fieldNames.size === 0) {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (configEdit) has empty fields map — ` +
            `declare at least one field.`,
        );
      }
      for (const [fname, fdef] of Object.entries(screen.fields)) {
        // @cast-boundary schema-walk — feature-config inspection
        const ftype = (fdef as { type?: unknown }).type;
        if (typeof ftype !== "string" || ftype.length === 0) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (configEdit) field "${fname}" has no ` +
              `\`type\` set. Each field must declare a type (e.g. "text", "number", "select").`,
          );
        }
      }
      if (screen.layout.sections.length === 0) {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (configEdit) has an empty sections list — ` +
            `declare at least one section.`,
        );
      }
      for (const section of screen.layout.sections) {
        if (section.fields.length === 0) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (configEdit) has a section "${section.title}" ` +
              `with zero fields — drop the section or add fields to it.`,
          );
        }
        for (const fieldSpec of section.fields) {
          const normalized = normalizeEditField(fieldSpec);
          if (!fieldNames.has(normalized.field)) {
            throw new Error(
              `[Feature ${feature.name}] Screen "${screenId}" (configEdit) layout references unknown ` +
                `field "${normalized.field}". Known fields: ${[...fieldNames].sort().join(", ")}`,
            );
          }
        }
      }
      // configKeys: jeder fieldName muss einen Mapping-Eintrag haben,
      // jeder qualifizierte Key muss in der Registry existieren.
      for (const fname of fieldNames) {
        const qualified = screen.configKeys[fname];
        if (qualified === undefined) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (configEdit) field "${fname}" hat ` +
              `keinen Eintrag in configKeys-Map. Jedes deklarierte Field braucht ein Mapping zu ` +
              `einem qualifizierten Config-Key (\`<feature>:config:<short>\`).`,
          );
        }
        if (!allConfigKeyQns.has(qualified)) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (configEdit) field "${fname}" → ` +
              `Config-Key "${qualified}" ist in keiner Feature-Registry deklariert. Tippfehler? ` +
              `Erwartetes Format: "<feature>:config:<short>". Bekannte Keys: ${
                [...allConfigKeyQns].sort().join(", ") || "(keine)"
              }`,
          );
        }
      }
      continue;
    }

    if (screen.type === "actionForm") {
      // Tier 2.7d: Action-Form-Screens haben keinen entity-Link, nur
      // einen Write-Handler-QN + Inline-Fields. Sechs Author-Code-
      // Checks am Boot:
      //   1) handler ist non-empty String.
      //   2) handler ist als Write-Handler registriert (cross-feature-
      //      Lookup gegen die collected QN-Map). Tippfehler/umbenannte
      //      Handler fallen sonst erst beim ersten Klick als 404 auf.
      //   3) fields-Map ist non-empty.
      //   4) Jeder Field-Eintrag hat einen `type`-Discriminator
      //      (Tippfehler in Schema → Renderer crasht stumm sonst).
      //   5) layout.sections + jedes referenced field existiert in
      //      fields.
      //   6) redirect (wenn gesetzt) verweist auf einen registrierten
      //      Screen-QN (Cross-Feature ok).
      if (!screen.handler || typeof screen.handler !== "string") {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (actionForm) has empty or non-string handler.`,
        );
      }
      if (!allWriteHandlerQns.has(screen.handler)) {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (actionForm) handler "${screen.handler}" ` +
            `is not a registered write-handler. Check the QN spelling (expected ` +
            `"<feature>:write:<short>") and that the handler is declared via r.writeHandler(...).`,
        );
      }
      const fieldNames = new Set(Object.keys(screen.fields));
      if (fieldNames.size === 0) {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (actionForm) has empty fields map — ` +
            `declare at least one field.`,
        );
      }
      // Jeder Field-Eintrag muss einen `type`-Discriminator haben.
      // Author-Tippfehler (`title: { required: true }` ohne type) →
      // RenderField fällt zur Laufzeit auf den Default-Renderer und
      // schickt einen leeren String — silent broken. Boot-Fail ist
      // klarer. `type as unknown` weil FieldDefinition als Union nur
      // bekannte Strings erlaubt; wir prüfen Author-Code, der ggf.
      // den Type-Check umgangen hat.
      for (const [fname, fdef] of Object.entries(screen.fields)) {
        // @cast-boundary schema-walk — feature-config inspection (Author may circumvent type-check)
        const ftype = (fdef as { type?: unknown }).type;
        if (typeof ftype !== "string" || ftype.length === 0) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (actionForm) field "${fname}" has no ` +
              `\`type\` set. Each field must declare a type (e.g. "text", "number", "select").`,
          );
        }
      }
      if (screen.layout.sections.length === 0) {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (actionForm) has an empty sections list — ` +
            `declare at least one section.`,
        );
      }
      for (const section of screen.layout.sections) {
        if (section.fields.length === 0) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (actionForm) has a section "${section.title}" ` +
              `with zero fields — drop the section or add fields to it.`,
          );
        }
        for (const fieldSpec of section.fields) {
          const normalized = normalizeEditField(fieldSpec);
          if (!fieldNames.has(normalized.field)) {
            throw new Error(
              `[Feature ${feature.name}] Screen "${screenId}" (actionForm) layout references unknown field ` +
                `"${normalized.field}". Known fields: ${[...fieldNames].sort().join(", ")}`,
            );
          }
        }
      }
      if (screen.redirect !== undefined) {
        // redirect ist die kurze Screen-ID (z.B. "item-list"); der
        // nav-Router resolved sie beim Mount gegen die Schema-Map.
        // Cross-Feature-Redirect ist nicht supported — der nav-Router
        // baut die URL aus screenId direkt, eine voll-QN würde als
        // `/shop:screen:foo/` landen und nirgendwo greifen.
        const candidateQn = qualifyEntityName(feature.name, "screen", screen.redirect);
        if (!allScreenQns.has(candidateQn)) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (actionForm) redirect "${screen.redirect}" ` +
              `does not resolve to a registered screen in this feature. Known screens: ${
                [...Object.keys(feature.screens)].sort().join(", ") || "(none)"
              }.`,
          );
        }
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
        validateColumnRendererForm(feature.name, screenId, normalized);
      }
      // Pagination/Sort/Search-Validierung: Author-Fehler beim Boot
      // fangen, damit kein "warum kommt die Liste leer / falsch
      // sortiert"-Debug-Cycle zur Laufzeit losgeht.
      if (screen.pageSize !== undefined && screen.pageSize <= 0) {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (entityList) has pageSize=${screen.pageSize} — ` +
            `must be a positive integer.`,
        );
      }
      if (screen.defaultSort !== undefined) {
        const sortField = screen.defaultSort.field;
        if (!fieldNames.has(sortField)) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (entityList) defaultSort references unknown ` +
              `field "${sortField}". Known fields: ${[...fieldNames].sort().join(", ")}`,
          );
        }
        // sortable: true Pflicht — verhindert dass das UI auf einer
        // Spalte sortiert, die Server-Side gar keinen DB-Index hat
        // oder im Schema absichtlich nicht sortiert werden soll
        // (Audit-Felder, Computed-Werte). `sortable` lebt heute nur
        // auf TextFieldDef; "in"-narrow lässt das auch für andere
        // Field-Types ohne explizites Flag durchfallen, was ok ist:
        // Number/Date sind natürlich sortierbar, der Author kann sie
        // im Author-Code als sortable markieren wenn das Field-Type
        // es trägt (Erweiterung folgt).
        const fieldDef = entityDef.fields[sortField];
        const isSortable =
          fieldDef !== undefined && "sortable" in fieldDef && fieldDef.sortable === true;
        if (!isSortable) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (entityList) defaultSort.field "${sortField}" ` +
              `is not sortable. Set sortable: true on the field definition or pick another field.`,
          );
        }
      }
      // Screen-Filter (Tier 2.7c) — drei Layer Author-Code-Check:
      //   1) Field existiert auf der Entity (Tippfehler = leere Liste
      //      statt Crash; Boot-Fail ist deutlich besser).
      //   2) Field hat `filterable: true` (Author opt-in, analog zu
      //      `sortable`). Verhindert dass Audit-/Computed-/encrypted-
      //      Felder unbeabsichtigt filterbar werden.
      //   3) Op passt zum Field-Type. Lt/gt auf text-Feldern → Boot-
      //      Fail mit Hinweis statt String-Sort-Surprise zur Laufzeit.
      // Außerdem: "in" verlangt readonly Array.
      if (screen.filter !== undefined) {
        const filterField = screen.filter.field;
        if (!fieldNames.has(filterField)) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (entityList) filter references unknown ` +
              `field "${filterField}". Known fields: ${[...fieldNames].sort().join(", ")}`,
          );
        }
        const fieldDef = entityDef.fields[filterField];
        if (fieldDef !== undefined && !isFieldFilterable(fieldDef)) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (entityList) filter references field ` +
              `"${filterField}" which is not filterable. Set filterable: true on the field ` +
              `definition or pick another field.`,
          );
        }
        if (fieldDef !== undefined) {
          const allowedOps = getAllowedFilterOps(fieldDef);
          if (!allowedOps.includes(screen.filter.op)) {
            throw new Error(
              `[Feature ${feature.name}] Screen "${screenId}" (entityList) filter.op ` +
                `"${screen.filter.op}" is not allowed on field "${filterField}" ` +
                `(type "${fieldDef.type}"). Allowed ops: ${allowedOps.join(", ") || "(none)"}.`,
            );
          }
        }
        if (screen.filter.op === "in" && !Array.isArray(screen.filter.value)) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (entityList) filter.op "in" requires ` +
              `filter.value to be a readonly array.`,
          );
        }
      }
      // Tier 2.7e-1: rowActions mit kind:"navigate" pinst dass das
      // referenced screen tatsächlich existiert (selbes Feature). Ein
      // typo'd target landet sonst beim Klick als "Screen not found"-
      // Banner.
      if (screen.rowActions !== undefined) {
        for (const action of screen.rowActions) {
          if (action.kind !== "navigate") continue;
          const candidateQn = qualifyEntityName(feature.name, "screen", action.screen);
          if (!allScreenQns.has(candidateQn)) {
            throw new Error(
              `[Feature ${feature.name}] Screen "${screenId}" (entityList) rowAction "${action.id}" ` +
                `navigate-target "${action.screen}" does not resolve to a registered screen in this feature.`,
            );
          }
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

// Form-check für ListColumn-Renderer in der PlatformComponent-Form
// (`{ react: { __component: "Name" } }`). Der Server kennt die client-
// seitige columnRenderers-Map nicht — also nur prüfen ob die Struktur
// stimmt: wenn `react` als Object gesetzt ist, MUSS `__component` ein
// nicht-leerer String sein. Ein client-seitig ausgelassener Key löst
// nur eine Warnung aus, kein Boot-Fail.
function validateColumnRendererForm(
  featureName: string,
  screenId: string,
  column: { readonly field: string; readonly renderer?: unknown },
): void {
  const renderer = column.renderer;
  // skip: nur die PlatformComponent-Form ({ react: { __component: "..." } })
  // wird strukturell validiert. Funktions-, String-QN- und null/undefined-
  // Renderer sind alle gültige andere Formen — kein Form-Fehler.
  if (renderer === null || typeof renderer !== "object") return;
  // @cast-boundary schema-walk — feature-config renderer-shape introspection
  const react = (renderer as { react?: unknown }).react;
  // skip: kein react-Branch → entweder native-only oder kein
  // PlatformComponent — beides außerhalb dieses Checks.
  if (react === undefined || react === null) return;
  if (typeof react !== "object") {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" column "${column.field}" has a renderer with ` +
        `a non-object \`react\` branch — expected \`{ react: { __component: "Name" } }\`.`,
    );
  }
  // @cast-boundary schema-walk — feature-config react-branch introspection
  const component = (react as { __component?: unknown }).__component;
  // skip: ohne __component-Schlüssel ist das keine String-Key-Form
  // (z.B. ein zukünftiger direkter Component-Ref); nicht unsere Domäne.
  if (component === undefined) return;
  if (typeof component !== "string" || component.length === 0) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" column "${column.field}" has a renderer with ` +
        `\`react.__component\` = ${JSON.stringify(component)} — expected a non-empty string identifying ` +
        `a client-side columnRenderers entry.`,
    );
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

// Sammelt alle qualifizierten Write-Handler-QNs (`<feature>:write:<short>`).
// Wird vom actionForm-Screen-Validator genutzt um zu prüfen ob der
// im Schema deklarierte handler tatsächlich registriert ist —
// Tippfehler/umbenannte Handler fallen sonst erst zur Laufzeit auf.
function collectWriteHandlerQns(features: readonly FeatureDefinition[]): Set<string> {
  const set = new Set<string>();
  for (const f of features) {
    for (const handlerName of Object.keys(f.writeHandlers)) {
      set.add(qualifyEntityName(f.name, "write", handlerName));
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
  allWorkspaceQns: ReadonlyMap<string, WorkspaceDefinition & { readonly featureName: string }>,
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
    if (navDef.workspaces !== undefined) {
      for (const wsQn of navDef.workspaces) {
        if (!allWorkspaceQns.has(wsQn)) {
          throw new Error(
            `[Feature ${feature.name}] Nav entry "${navId}" self-assigns to workspace "${wsQn}" ` +
              `which is not registered. Expected a qualified name of the form ` +
              `"<feature>:workspace:<id>" pointing at an r.workspace() declaration.`,
          );
        }
      }
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

// --- Workspace validation ---
//
// Per-app workspace registry, built once up front. Carries `featureName`
// alongside the definition so error messages can point at the offending
// feature without a parallel reverse index.

function collectWorkspaceQns(
  features: readonly FeatureDefinition[],
): Map<string, WorkspaceDefinition & { readonly featureName: string }> {
  const map = new Map<string, WorkspaceDefinition & { readonly featureName: string }>();
  for (const f of features) {
    for (const [wsId, wsDef] of Object.entries(f.workspaces)) {
      const qualified = qualifyEntityName(f.name, "workspace", wsId);
      map.set(qualified, { ...wsDef, featureName: f.name });
    }
  }
  return map;
}

function validateWorkspaces(
  feature: FeatureDefinition,
  allNavQns: ReadonlyMap<string, NavDefinition & { readonly featureName: string }>,
): void {
  for (const [wsId, wsDef] of Object.entries(feature.workspaces)) {
    if (wsDef.nav !== undefined) {
      for (const navQn of wsDef.nav) {
        if (!allNavQns.has(navQn)) {
          throw new Error(
            `[Feature ${feature.name}] Workspace "${wsId}" references nav "${navQn}" ` +
              `which is not registered. Expected a qualified name of the form ` +
              `"<feature>:nav:<id>" pointing at an r.nav() declaration.`,
          );
        }
      }
    }
  }
}

// Single-default rule across the entire app. Mirrors how createApp validates
// roles up front — a second `default: true` is a configuration error, not a
// runtime fallback. Apps without any default fall back to "first workspace
// the user has access to" at render time (handled by shellWorkspaces).
function validateDefaultWorkspaceUniqueness(
  allWorkspaceQns: ReadonlyMap<string, WorkspaceDefinition & { readonly featureName: string }>,
): void {
  const defaults: string[] = [];
  for (const [qn, ws] of allWorkspaceQns) {
    if (ws.default === true) defaults.push(qn);
  }
  if (defaults.length > 1) {
    throw new Error(
      `[Kumiko Workspaces] Multiple workspaces declare default: true — ` +
        `${defaults.join(", ")}. At most one workspace per app may be the default.`,
    );
  }
}
