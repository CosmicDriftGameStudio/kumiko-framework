import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createBooleanField,
  createEntity,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";

export const tenantEntity = createEntity({
  table: "read_tenants",
  // tenant.id IS the tenantId-value that every other table references as FK.
  // Alle tenantId-Spalten sind UUID (Migration 2026-04-16) → tenant.id muss
  // UUID sein, sonst findet der tenants-Lookup nie. Default gen_random_uuid().
  fields: {
    key: createTextField({ required: true, maxLength: 50 }),
    name: createTextField({ required: true, maxLength: 200, searchable: true }),
    isEnabled: createBooleanField({ default: true }),
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
