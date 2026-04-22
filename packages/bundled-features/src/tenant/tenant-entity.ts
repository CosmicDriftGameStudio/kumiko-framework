import { buildDrizzleTable } from "@kumiko/framework/db";
import { createBooleanField, createEntity, createTextField } from "@kumiko/framework/engine";

export const tenantEntity = createEntity({
  table: "tenants",
  // tenant.id IS the tenantId-value that every other table references as FK.
  // Alle tenantId-Spalten sind UUID (Migration 2026-04-16) → tenant.id muss
  // UUID sein, sonst findet der tenants-Lookup nie. Default gen_random_uuid().
  idType: "uuid",
  fields: {
    key: createTextField({ required: true, maxLength: 50 }),
    name: createTextField({ required: true, maxLength: 200, searchable: true }),
    isEnabled: createBooleanField({ default: true }),
  },
});

export const tenantTable = buildDrizzleTable("tenant", tenantEntity);
