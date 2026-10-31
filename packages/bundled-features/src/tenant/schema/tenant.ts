import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createBooleanField,
  createEntity,
  createSelectField,
  createTextField,
  createTimestampField,
} from "@cosmicdrift/kumiko-framework/engine";

export const TENANT_LIFECYCLE_STATUSES = [
  "active",
  "destroyRequested",
  "destroying",
  "destroyHeld",
  "destroyFailed",
  "destroyed",
] as const;

export type TenantLifecycleStatus = (typeof TENANT_LIFECYCLE_STATUSES)[number];

export const tenantEntity = createEntity({
  description:
    "A tenant, the isolated workspace every other record belongs to, holding its key and display name, whether it is enabled, and its destruction-lifecycle state.",
  table: "read_tenants",
  // Tenant-independent aggregate: stream, row and search bucket live on SYSTEM_TENANT_ID, not on the acting user's tenant.
  systemStream: true,
  tenancy: "global",
  // `tenant.id` is the `tenantId` value referenced by every other table as a foreign key.
  // Every `tenantId` column is UUID, so `tenant.id` must also be UUID; otherwise
  // the tenant lookup never finds a match. The default is `gen_random_uuid()`.
  fields: {
    key: createTextField({
      required: true,
      maxLength: 50,
      sortable: true,
      personal: false,
      reason: "technical_reference",
    }),
    // Subject is the tenant record itself: the stream lives on SYSTEM_TENANT_ID, so `personal: "tenant"` would not resolve to this tenant.
    name: createTextField({
      required: true,
      maxLength: 200,
      searchable: true,
      personal: { of: "id" },
      find: "none",
    }),
    isEnabled: createBooleanField({ default: true, filterable: true }),
    // Tenant-destroy lifecycle (tenant-lifecycle feature). Defaults keep
    // existing tenants valid when the feature is not mounted.
    status: createSelectField({
      options: TENANT_LIFECYCLE_STATUSES,
      default: "active",
      required: true,
      filterable: true,
    }),
    destroyRequestedAt: createTimestampField({}),
    destroyRequestedBy: createTextField({
      maxLength: 36,
      personal: false,
      reason: "pseudonymous_fk",
    }),
    gracePeriodEnd: createTimestampField({}),
    destroyStartedAt: createTimestampField({}),
    destroyedAt: createTimestampField({}),
  },
  // `tenant.key` appears in admin URLs (`admin.<host>/<key>/...`) and must be unique.
  // Without a unique constraint, concurrent self-signup confirmation could pass
  // the `generateUniqueName` `isAvailable` check before either insert, allowing
  // two tabs to claim the same slug and causing users to share an admin URL prefix.
  indexes: [{ unique: true, columns: ["key"] }],
});

export const tenantTable = buildEntityTable("tenant", tenantEntity);
