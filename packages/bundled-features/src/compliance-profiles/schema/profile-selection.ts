import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createLongTextField,
  createSelectField,
} from "@cosmicdrift/kumiko-framework/engine";

// One-to-one relationship: each tenant has exactly one profile selection.
//
// Profile selection is a separate entity in the compliance-profiles feature,
// not a config key in the tenant feature, because:
//   (a) override is structured JSON, while the config-key pattern
//       (timezone/locale) is flat key-value data
//   (b) profile changes are audit-relevant, which the event store handles
//       automatically for entity writes
//
// override is stored as a JSON string in longText because the framework has
// no dedicated jsonField type; embedded has a fixed schema, while this schema
// is dynamic. Zod validation in the set-profile handler ensures schema
// conformity.
export const tenantComplianceProfileEntity = createEntity({
  table: "read_tenant_compliance_profiles",
  fields: {
    profileKey: createSelectField({
      required: true,
      options: ["eu-dsgvo", "swiss-dsg", "de-hr-dsgvo-hgb", "minimal-no-region"] as const,
    }),
    // override: JSON string containing a partial ComplianceProfile. NULL/empty
    // means "default profile, no override". Validated by the
    // set-profile handler via Zod.
    override: createLongTextField({
      personal: false,
      reason: "is_business_data",
    }),
  },
  indexes: [
    // Only one profile record is allowed per tenant. Although the boot validator
    // warns that a single-column tenantId index is redundant, the UNIQUE
    // constraint is semantically required here for the one-to-one relationship,
    // not merely a performance hint, so it is declared explicitly.
    { unique: true, columns: ["tenantId"] },
  ],
});

export const tenantComplianceProfileTable = buildEntityTable(
  "tenantComplianceProfile",
  tenantComplianceProfileEntity,
);
