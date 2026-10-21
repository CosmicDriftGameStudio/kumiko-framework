import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createLongTextField,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";

// tenantRetentionOverride — Layer 3 in the three-layer resolver.
//
// One optional override config per (tenantId, entityName) replaces the
// preset (Layer 2) for that entity only. Use cases:
//   - Law firm in DE: caseFile 6y blockDelete (not in the preset)
//   - Pilot tenant retaining data longer for testing
//   - Industry-specific shorter retention periods
//
// reason is required so the decision is auditable by the DPO and supervisory
// authorities.
//
// config is a JSON string with `{ keepFor, strategy, reference? }`. The Zod
// schema validates it when set-override is called.
//
// Tenant one-to-many: each tenant can have any number of entity overrides.
// A UNIQUE index on (tenantId, entityName) allows at most one override per
// entity.
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
