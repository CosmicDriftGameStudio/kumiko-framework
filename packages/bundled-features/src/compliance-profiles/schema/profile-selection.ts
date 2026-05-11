import { buildDrizzleTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createLongTextField,
  createSelectField,
} from "@cosmicdrift/kumiko-framework/engine";

// Tenant-1-zu-1: Pro Tenant genau eine Profile-Wahl.
//
// Architektur-Entscheidung (2026-05-06): Profile-Selection lebt als
// separate Entity im compliance-profiles-Feature, NICHT als config-key
// im tenant-Feature. Begruendung:
//   (a) override ist strukturiertes JSON, config-key-Pattern (timezone/
//       locale) ist key-value-flach
//   (b) Profile-Wechsel ist audit-relevant — Event-Store gibt das
//       automatisch fuer Entity-Writes
//   (c) Plan-Files in docs/plans/datenschutz/compliance-profiles.md
//       nennen sie explizit als tenantComplianceProfile-Entity
//
// Wer in 6 Monaten zweifelt warum nicht config-key: siehe oben.
//
// override als JSON-String in longText: kein dedizierter jsonField-Typ
// im Framework; embedded hat festes Schema, das hier dynamisch ist.
// Zod-Validation beim set-profile-Handler stellt Schema-Konformitaet
// sicher.
export const tenantComplianceProfileEntity = createEntity({
  table: "read_tenant_compliance_profiles",
  fields: {
    profileKey: createSelectField({
      required: true,
      options: ["eu-dsgvo", "swiss-dsg", "de-hr-dsgvo-hgb", "minimal-no-region"] as const,
    }),
    // override: JSON-String mit Partial-ComplianceProfile. NULL/leer
    // bedeutet "Default-Profile, keine Override". Validiert beim
    // set-profile-Handler via Zod.
    override: createLongTextField({
      allowPlaintext: "is-business-data",
    }),
  },
  indexes: [
    // Pro Tenant nur EIN Profile-Datensatz. Boot-Validator-Comment in
    // EntityIndexDef warnt vor single-column-tenantId-Index als redundant
    // — UNIQUE-Constraint ist hier aber semantisch noetig (1:1-Relation)
    // und nicht nur Performance-Hint, daher explizit deklariert.
    { unique: true, columns: ["tenantId"] },
  ],
});

export const tenantComplianceProfileTable = buildDrizzleTable(
  "tenantComplianceProfile",
  tenantComplianceProfileEntity,
);
