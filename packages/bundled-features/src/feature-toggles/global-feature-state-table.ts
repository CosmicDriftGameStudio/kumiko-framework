import { boolean, instant, integer, table as pgTable, text } from "@cosmicdrift/kumiko-framework/db";
import { sql } from "drizzle-orm";

// Global feature-toggle override state. One row per feature that has ever
// been explicitly flipped by an operator. Missing row = "no override,
// fall back to the feature's r.toggleable({ default }) value".
//
// PK is featureName (text) — not a surrogate UUID — because the feature
// name IS the identity here. No tenantId: this is a global override that
// applies across every tenant (per-tenant toggles are intentionally out of
// scope, see core-feature-toggles.md).
export const globalFeatureStateTable = pgTable("read_global_feature_state", {
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
