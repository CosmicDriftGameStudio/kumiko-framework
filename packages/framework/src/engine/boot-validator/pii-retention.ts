import type { FeatureDefinition } from "../types";
import type { ResolvedPiiFlags } from "../types/fields";
import {
  PII_DIRECT_NAME_HINTS,
  PII_USER_OWNED_NAME_HINTS,
  PII_USER_REFERENCE_NAME_HINTS,
} from "./entity-handler";

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

// Excludes subjectRef: its `personal: "ref"` union member structurally
// forbids `anonymize` (packages/types/src/fields.ts) — #2336.
function hasAnonymizableSubjectField(annot: ResolvedPiiFlags): boolean {
  return Boolean(annot.pii || annot.userOwned || annot.tenantOwned);
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
//    Mit `{ personal: false, reason: "<reason>" }` unterdrückbar (geht in Audit).
//
// 4. Retention-Integrity: retention.reference (wenn gesetzt) muss auf
//    ein bestehendes Field zeigen (oder Framework-Timestamp). retention.
//    strategy="blockDelete" ohne anonymize-Felder ist sinnlos — User-
//    Forget kann nichts machen, Warning.
//
// Encrypt/Decrypt-Mechanik landet in Sprint 3 (crypto-shredding); diese
// Validation greift schon ab Sprint 0 damit Schema-Drift früh auffällt.
export function validatePiiAndRetention(feature: FeatureDefinition): void {
  for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
    const fieldsByName = entity.fields;

    for (const [fieldName, field] of Object.entries(fieldsByName)) {
      // ResolvedPiiFlags-Properties sind type-level optional. Auf Field-
      // Defs die nicht via "& ResolvedPiiFlags" erweitert sind (Boolean,
      // Money, Reference, Embedded, Tz, LocatedTimestamp, File*, Image*)
      // liefert property-access undefined zur Runtime. Die TS-Compile-
      // Time-Validation hat dort schon abgelehnt → Cast ist safe.
      const annot = field as ResolvedPiiFlags; // @cast-boundary schema-walk

      const hasPii = Boolean(annot.pii);
      const hasUserOwned = Boolean(annot.userOwned);
      const hasTenantOwned = Boolean(annot.tenantOwned);
      const annotCount = (hasPii ? 1 : 0) + (hasUserOwned ? 1 : 0) + (hasTenantOwned ? 1 : 0);

      if (annotCount > 1) {
        throw new Error(
          `[Feature ${feature.name}] Field "${fieldName}" on entity "${entityName}" has multiple subject-key annotations (personal: "self" / "tenant" / { of: "<field>" }). Pick one — each field belongs to exactly one subject.`,
        );
      }

      // lookupable (#818): nur text + nur MIT Subject-Annotation. Ohne
      // Subject bleibt der Wert eh Klartext — der Blind-Index wäre eine
      // zweite (deterministische!) Kopie ohne Nutzen.
      if (annot.lookupable === true) {
        if (field.type !== "text") {
          throw new Error(
            `[Feature ${feature.name}] Field "${fieldName}" on entity "${entityName}" declares find: "exact" (or "fuzzy") but has type "${field.type}" — blind-index equality lookups only apply to text fields.`,
          );
        }
        if (annotCount === 0) {
          throw new Error(
            `[Feature ${feature.name}] Field "${fieldName}" on entity "${entityName}" declares find: "exact" (or "fuzzy") without a subject annotation (personal: "self" / "tenant" / { of: "<field>" }). Plaintext fields don't need a blind index — add personal or set find: "none".`,
          );
        }
      }

      // sensitive-Felder liegen seit #967 als Tabellen-Ciphertext im Event-
      // Log — ohne ciphertext-at-rest würde der Append Klartext in die
      // immutable History schreiben.
      const sensitiveFlags = field as {
        readonly sensitive?: boolean;
        readonly encrypted?: boolean;
      }; // @cast-boundary schema-walk
      if (
        sensitiveFlags.sensitive === true &&
        annotCount === 0 &&
        sensitiveFlags.encrypted !== true
      ) {
        throw new Error(
          `[Feature ${feature.name}] Field "${fieldName}" on entity "${entityName}" declares { sensitive: true } without ciphertext-at-rest. Since #967 the event log stores sensitive fields as table ciphertext — add a subject annotation (personal: "self" / "tenant" / { of: "<field>" }) or { encrypted: true }.`,
        );
      }

      // Sorting reads the projection column — that stays ciphertext, so
      // sortable + subject annotation stays a boot-fail. searchable has
      // been allowed since #1610: the search consumer decrypts into the
      // derived index and forget purges those docs (see
      // createSearchEventConsumer). sensitive + searchable stays forbidden
      // (nobody-may-read-back).
      {
        const flags = field as {
          readonly searchable?: boolean;
          readonly sortable?: boolean;
          readonly sensitive?: boolean;
        }; // @cast-boundary schema-walk
        if (annotCount > 0 && flags.sortable === true) {
          throw new Error(
            `[Feature ${feature.name}] Field "${fieldName}" on entity "${entityName}" combines a subject-key annotation with { sortable: true } — sorting reads the projection column, which is ciphertext at rest. For equality lookups use find: "exact"; drop sortable or keep the field plaintext (personal: false).`,
          );
        }
        if (flags.sensitive === true && flags.searchable === true) {
          throw new Error(
            `[Feature ${feature.name}] Field "${fieldName}" on entity "${entityName}" combines { sensitive: true } with { searchable: true } — sensitive means nobody may read the value back (passwords, tokens, tax IDs). Subject-annotated identity fields may be searchable (#1610); sensitive fields may not.`,
          );
        }
      }

      if (annot.userOwned) {
        const ownerName = annot.userOwned.ownerField;
        if (!ownerName || typeof ownerName !== "string") {
          throw new Error(
            `[Feature ${feature.name}] Field "${fieldName}" on entity "${entityName}" has personal: { of: ... } without an owner field name`,
          );
        }
        const ownerField = fieldsByName[ownerName];
        if (!ownerField) {
          const known = Object.keys(fieldsByName).sort().join(", ");
          throw new Error(
            `[Feature ${feature.name}] Field "${fieldName}" on entity "${entityName}" references personal.of "${ownerName}" but no such field exists. Known fields: ${known}`,
          );
        }
        // Text is accepted alongside reference: the ES-framework carries
        // user ids as plain text columns throughout the bundled features
        // (user-session.userId, invitation.invitedBy) — there is no
        // relational FK to point a reference at. Self-referencing
        // ownerField (the field's own value IS the owner id) rides on this.
        if (ownerField.type !== "reference" && ownerField.type !== "text") {
          throw new Error(
            `[Feature ${feature.name}] personal.of "${ownerName}" on entity "${entityName}" must be a reference or text (userId) field, got type "${ownerField.type}"`,
          );
        }
        // Soft-Warning wenn das reference-target nicht offensichtlich user
        // ist — custom subject-entities (HR-Mitarbeiter, Patient) sind
        // erlaubt, müssen aber bewusste Wahl sein.
        if (ownerField.type === "reference") {
          const refTarget = ownerField.entity;
          const targetEntity = refTarget.includes(":") ? refTarget.split(":")[1] : refTarget;
          if (targetEntity !== "user") {
            // biome-ignore lint/suspicious/noConsole: boot-time dev hint, no logger available yet
            console.warn(
              `[kumiko:boot] [Feature ${feature.name}] personal.of "${ownerName}" on entity "${entityName}" targets reference "${refTarget}" — typically should be a user reference. If intentional (custom subject-entity like employee/patient), ignore.`,
            );
          }
        }
      }

      // PII-Heuristik: nur wenn keine Annotation gesetzt UND kein
      // allowPlaintext-Marker. Ergibt false positives auf Geschäftsdaten
      // mit personenartigem Namen (z.B. company.legalName) — Author
      // unterdrückt mit { personal: false, reason: "is_business_data" }.
      const noAnnotation = annotCount === 0 && !annot.allowPlaintext;
      if (noAnnotation) {
        const lower = fieldName.toLowerCase();
        if (PII_DIRECT_NAME_HINTS.has(lower)) {
          // biome-ignore lint/suspicious/noConsole: boot-time dev hint, no logger available yet
          console.warn(
            `[kumiko:boot] [Feature ${feature.name}] Field "${fieldName}" on entity "${entityName}" has a PII-typical name but no personal annotation. If this is PII, mark it { personal: "self", find: ... }. If business data, set { personal: false, reason: "is_business_data" } to silence.`,
          );
        } else if (PII_USER_OWNED_NAME_HINTS.has(lower)) {
          // biome-ignore lint/suspicious/noConsole: boot-time dev hint, no logger available yet
          console.warn(
            `[kumiko:boot] [Feature ${feature.name}] Field "${fieldName}" on entity "${entityName}" has a user-content-typical name but no personal annotation. If this contains user-generated content, mark it { personal: { of: "<authorIdField>" }, find: ... }. If business data, set { personal: false, reason: "..." } to silence.`,
          );
        } else if (PII_USER_REFERENCE_NAME_HINTS.has(lower) && !annot.subjectRef) {
          // biome-ignore lint/suspicious/noConsole: boot-time dev hint, no logger available yet
          console.warn(
            `[kumiko:boot] [Feature ${feature.name}] Field "${fieldName}" on entity "${entityName}" has a user-reference-typical name but no personal annotation — a foreign key into \`user\` carries Art.17 obligations even with no annotated content on the entity. Mark it { personal: "ref" } AND register r.useExtension(EXT_USER_DATA, "${entityName}", …) — without the hook the V3 boot guard throws. Or { personal: { of: "${fieldName}" } } on the field it owns. If business data, set { personal: false, reason: "..." } to silence.`,
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
        // blockDelete with no field that can carry `anonymize` is fine;
        // subjectRef-only entities are covered by the V3 EXT_USER_DATA guard
        // instead (#1622, #2336).
        const entityHasAnonymizableSubjectField = Object.values(fieldsByName).some(
          (f) => hasAnonymizableSubjectField(f as ResolvedPiiFlags), // @cast-boundary schema-walk
        );
        const hasAnonymize = Object.values(fieldsByName).some((f) => {
          const a = f as ResolvedPiiFlags; // @cast-boundary schema-walk
          return Boolean(a.anonymize);
        });
        if (entityHasAnonymizableSubjectField && !hasAnonymize) {
          // biome-ignore lint/suspicious/noConsole: boot-time dev hint, no logger available yet
          console.warn(
            `[kumiko:boot] [Feature ${feature.name}] Entity "${entityName}" retention.strategy="blockDelete" but no field has an anonymize-function. User-Forget cannot anonymize — Forget will return error. Add { anonymize: () => null } or () => "[ANONYMIZED]" to PII fields.`,
          );
        }
      }
    }
  }
}
