import { deriveEntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  createEntity,
  createNumberField,
  createTextField,
  createTimestampField,
} from "@cosmicdrift/kumiko-framework/engine";

// One row per tenant. Direct-write store: the daily job and the keep-account handler mutate
// columns, there is no aggregate or event stream behind it.
export const tenantInactivityStateEntity = createEntity({
  name: "tenant-inactivity-state",
  table: "store_tenant_inactivity_state",
  softDelete: false,
  fields: {
    tenantId: createTextField({
      required: true,
      maxLength: 36,
      access: { write: access.privileged },
      personal: false,
      reason: "pseudonymous_fk",
    }),
    cycleId: createTextField({
      required: true,
      maxLength: 36,
      access: { write: access.privileged },
      personal: false,
      reason: "technical_reference",
    }),
    firstSeenAt: createTimestampField({ required: true, access: { write: access.privileged } }),
    lastActivityAt: createTimestampField({ access: { write: access.privileged } }),
    lastExemptAt: createTimestampField({ access: { write: access.privileged } }),
    lastWarnedAt: createTimestampField({ access: { write: access.privileged } }),
    postponedDueAt: createTimestampField({ access: { write: access.privileged } }),
    warningsSent: createNumberField({
      required: true,
      integer: true,
      min: 0,
      access: { write: access.privileged },
    }),
  },
  indexes: [{ unique: true, columns: ["tenantId"], name: "store_tenant_inactivity_state_tenant" }],
});

export const tenantInactivityStateTable = deriveEntityTableMeta(tenantInactivityStateEntity, {
  source: "unmanaged",
});
