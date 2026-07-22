import {
  boolean,
  defineUnmanagedTable,
  type EntityTableMeta,
  instant,
  integer,
  table as pgTable,
  sql,
  text,
} from "@cosmicdrift/kumiko-framework/db";

// Global feature-toggle override state. One row per feature that has ever
// been explicitly flipped by an operator. Missing row = "no override,
// fall back to the feature's r.toggleable({ default }) value".
//
// PK is featureName (text) — not a surrogate UUID — because the feature
// name IS the identity here. No tenantId: this is a global override that
// applies across every tenant (per-tenant toggles are intentionally out of
// scope, see core-feature-toggles.md).
export const globalFeatureStateTable = pgTable("store_global_feature_state", {
  featureName: text("feature_name").primaryKey(),
  enabled: boolean("enabled").notNull(),
  // Optimistic-lock column. The set-handler reads the existing row, then
  // updates with `WHERE feature_name = ? AND version = ?`; a 0-row update
  // means someone else wrote concurrently — the handler retries the fetch.
  version: integer("version").notNull().default(1),
  updatedAt: instant("updated_at").default(sql`now()`).notNull(),
  // UserId (text — SessionUser.id is a uuid string post-ES).
  updatedBy: text("updated_by"),
});

// r.storeTable meta — without this, collectTableMetas(FEATURES) never
// sees the table, so `kumiko schema generate` reports no changes and no
// app ever gets a migration for it (framework gap, not app-local).
export const globalFeatureStateTableMeta: EntityTableMeta = defineUnmanagedTable({
  tableName: "store_global_feature_state",
  columns: [
    { name: "feature_name", pgType: "text", notNull: true, primaryKey: true },
    { name: "enabled", pgType: "boolean", notNull: true },
    { name: "version", pgType: "integer", notNull: true, defaultSql: "1" },
    { name: "updated_at", pgType: "timestamptz", notNull: true, defaultSql: "now()" },
    { name: "updated_by", pgType: "text", notNull: false },
  ],
});
