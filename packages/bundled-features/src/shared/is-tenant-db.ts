import type { DbRunner, TenantDb } from "@cosmicdrift/kumiko-framework/db";

// Structural probe: a TenantDb and a raw DbRunner both expose fetchOne/selectMany,
// so the shape alone can't tell them apart — `unsafeRaw` only exists on TenantDb.
// Shared so retention/compliance-profile resolvers that accept either (bulk cron
// vs. per-hook TenantDb) branch through one predicate instead of duplicating it.
export function isTenantDb(db: DbRunner | TenantDb): db is TenantDb {
  return typeof (db as Partial<TenantDb>).unsafeRaw === "function";
}
