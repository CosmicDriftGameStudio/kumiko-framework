import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createLongTextField,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";

// tenantRetentionOverride — Layer 3 im 3-Schicht-Resolver.
//
// Per (tenantId, entityName) eine optionale Override-Config die das
// Preset (Layer 2) für genau diese eine Entity überschreibt. Use-Cases:
//   - Anwaltskanzlei in DE: caseFile 6y blockDelete (nicht im Preset)
//   - Pilot-Tenant der länger speichert für Test
//   - Branchenspezifische verkürzte Fristen
//
// reason ist Pflicht — Audit für DPO + Aufsichtsbehörde nachvollziehbar.
//
// config ist JSON-String mit `{ keepFor, strategy, reference? }`. Zod-
// Schema validiert beim set-override-Call (S2.D2 ggf. erweitert).
//
// Tenant-1-zu-N: pro Tenant beliebig viele Entity-Overrides. UNIQUE-
// Index auf (tenantId, entityName) damit pro Entity max ein Override.
export const tenantRetentionOverrideEntity = createEntity({
  table: "read_tenant_retention_overrides",
  fields: {
    entityName: createTextField({
      required: true,
      maxLength: 100,
      personal: false,
      reason: "is_business_data",
    }),
    config: createLongTextField({
      required: true,
      personal: false,
      reason: "is_business_data",
    }),
    reason: createTextField({
      required: true,
      maxLength: 500,
      personal: false,
      reason: "is_business_data",
    }),
  },
  indexes: [{ unique: true, columns: ["tenantId", "entityName"] }],
});

export const tenantRetentionOverrideTable = buildEntityTable(
  "tenantRetentionOverride",
  tenantRetentionOverrideEntity,
);
