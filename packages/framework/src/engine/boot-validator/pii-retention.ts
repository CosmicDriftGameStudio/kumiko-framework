import type { FeatureDefinition } from "../types";
import type { PiiAnnotations } from "../types/fields";
import { PII_DIRECT_NAME_HINTS, PII_USER_OWNED_NAME_HINTS } from "./entity-handler";

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
export function validatePiiAndRetention(feature: FeatureDefinition): void {
  for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
    const fieldsByName = entity.fields;

    for (const [fieldName, field] of Object.entries(fieldsByName)) {
      // PiiAnnotations-Properties sind type-level optional. Auf Field-
      // Defs die nicht via "& PiiAnnotations" erweitert sind (Boolean,
      // Money, Reference, Embedded, Tz, LocatedTimestamp, File*, Image*)
      // liefert property-access undefined zur Runtime. Die TS-Compile-
      // Time-Validation hat dort schon abgelehnt → Cast ist safe.
      const annot = field as PiiAnnotations; // @cast-boundary schema-walk

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
        // Text is accepted alongside reference: the ES-framework carries
        // user ids as plain text columns throughout the bundled features
        // (user-session.userId, invitation.invitedBy) — there is no
        // relational FK to point a reference at. Self-referencing
        // ownerField (the field's own value IS the owner id) rides on this.
        if (ownerField.type !== "reference" && ownerField.type !== "text") {
          throw new Error(
            `[Feature ${feature.name}] userOwned.ownerField "${ownerName}" on entity "${entityName}" must be a reference or text (userId) field, got type "${ownerField.type}"`,
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
              `[kumiko:boot] [Feature ${feature.name}] userOwned.ownerField "${ownerName}" on entity "${entityName}" targets reference "${refTarget}" — typically should be a user reference. If intentional (custom subject-entity like employee/patient), ignore.`,
            );
          }
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
          const a = f as PiiAnnotations; // @cast-boundary schema-walk
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
