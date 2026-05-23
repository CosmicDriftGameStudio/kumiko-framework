import { parseRefTarget } from "../parse-ref-target";
import type { FeatureDefinition } from "../types";

export const FILE_FIELD_TYPES = new Set(["file", "image", "files", "images"]);

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
export const PII_DIRECT_NAME_HINTS: ReadonlySet<string> = new Set([
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
export const PII_USER_OWNED_NAME_HINTS: ReadonlySet<string> = new Set([
  "body",
  "text",
  "content",
  "message",
  "comment",
  "description",
  "note",
  "notes",
]);

// --- Handler access validation ---

// Rate-limit modes that bucket per user.id. Anonymous endpoints would put
// every unauthenticated caller into a single shared bucket (id="anonymous"),
// turning the rate-limit into a global tap any caller can drain. Boot-fail
// before the misconfiguration ships.
const USER_BUCKETED_RATE_LIMIT_PER: ReadonlySet<string> = new Set(["user", "user+handler"]);

// Every handler must declare access. Missing access is treated as default-deny
// at runtime, but we fail at boot to turn an easy-to-miss security regression
// into a loud configuration error.
export function validateHandlerAccess(feature: FeatureDefinition): void {
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

export function validateAnonymousRateLimit(
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
export function validateMultiStreamProjections(feature: FeatureDefinition): void {
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
export function validateLocatedTimestamps(feature: FeatureDefinition): void {
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
// `tenantId` als einzige Spalte ist redundant — buildEntityTable legt
// den Index sowieso automatisch an. Wir lassen die Composite-Form erlaubt
// (`["tenantId", "key"]` ist sinnvoll), nur die rein-tenantId-Single-
// column-Form blockieren wir.
export function validateEntityIndexes(feature: FeatureDefinition): void {
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
      // UNIQUE-constraint auf tenantId ist semantisch (1:1 tenant→entity)
      // und NICHT redundant — buildEntityTable's auto-Index ist nur ein
      // Performance-Hint, kein constraint. Nur die rein-tenantId-Single-
      // column-non-unique-Form blockieren.
      if (def.columns.length === 1 && def.columns[0] === "tenantId" && !def.unique) {
        throw new Error(
          `${where}: single-column index on "tenantId" is redundant — ` +
            `buildEntityTable always creates one automatically. Remove this entry.`,
        );
      }
    }
  }
}

// --- Encrypted field validation ---

export function validateEncryptedFields(feature: FeatureDefinition): boolean {
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

export function validateFileFields(feature: FeatureDefinition): boolean {
  for (const entity of Object.values(feature.entities)) {
    for (const field of Object.values(entity.fields)) {
      if (FILE_FIELD_TYPES.has(field.type)) return true;
    }
  }
  return false;
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
export function validateReferenceFields(
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

export function validateEmbeddedFields(feature: FeatureDefinition): void {
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
export function validateMultiSelectFields(feature: FeatureDefinition): void {
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

export function validateTransitions(feature: FeatureDefinition): void {
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

export function validateExtendSchemaCollisions(feature: FeatureDefinition): void {
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
