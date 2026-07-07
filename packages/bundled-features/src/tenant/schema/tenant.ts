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
  "destroyFailed",
  "destroyed",
] as const;

export type TenantLifecycleStatus = (typeof TENANT_LIFECYCLE_STATUSES)[number];

export const tenantEntity = createEntity({
  table: "read_tenants",
  // tenant.id IS the tenantId-value that every other table references as FK.
  // Alle tenantId-Spalten sind UUID (Migration 2026-04-16) → tenant.id muss
  // UUID sein, sonst findet der tenants-Lookup nie. Default gen_random_uuid().
  fields: {
    key: createTextField({ required: true, maxLength: 50 }),
    name: createTextField({ required: true, maxLength: 200, searchable: true }),
    isEnabled: createBooleanField({ default: true }),
    // Tenant-destroy lifecycle (tenant-lifecycle feature). Defaults keep
    // existing tenants valid when the feature is not mounted.
    status: createSelectField({
      options: TENANT_LIFECYCLE_STATUSES,
      default: "active",
      required: true,
      filterable: true,
    }),
    destroyRequestedAt: createTimestampField({}),
    destroyRequestedBy: createTextField({ maxLength: 36 }),
    gracePeriodEnd: createTimestampField({}),
    destroyStartedAt: createTimestampField({}),
    destroyedAt: createTimestampField({}),
  },
  // tenant.key wird in Admin-URLs verwendet (`admin.<host>/<key>/...`) und
  // muss eindeutig sein. Ohne unique-constraint hätte ein konkurrenter
  // Self-Signup-Confirm einen TOCTOU-Race zwischen generateUniqueName-
  // isAvailable-check und insert: zwei Tabs könnten sequentiell denselben
  // Slug claimen, beide commits durch, der dritte User landet auf einem
  // shared admin-URL-prefix.
  indexes: [{ unique: true, columns: ["key"] }],
});

export const tenantTable = buildEntityTable("tenant", tenantEntity);
