import { asEntityTableMeta } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  boolean,
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
// app ever gets a migration for it (framework gap, not app-local). Derived
// from the pgTable above instead of hand-written a second time — the two
// used to drift independently (framework#1529): a column added only to
// the pgTable made queries type-check while the migration generator stayed
// blind to it, failing in prod with "column ... does not exist" while every
// mocked-stack test stayed green.
const derivedMeta = asEntityTableMeta(globalFeatureStateTable);
if (!derivedMeta) {
  throw new Error(
    "global-feature-state-table: asEntityTableMeta(globalFeatureStateTable) returned undefined " +
      "— the pgTable definition no longer round-trips through the unmanaged-table meta builder.",
  );
}
export const globalFeatureStateTableMeta: EntityTableMeta = derivedMeta;
