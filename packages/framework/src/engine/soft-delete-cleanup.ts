// Auto-generated soft-delete maintenance. Hard-deletes entity rows that have
// been soft-deleted longer than the per-tenant grace period. Injected into the
// registry (the job + its config key) whenever ANY entity opts into softDelete
// — see createRegistry. Runtime twin to the auto restore-handler: softDelete:
// true buys an entity restore + trash (ctx.includeDeleted) + this cleanup, with
// no feature to wire.
//
// Hard-deleting the projection row leaves the event stream intact (source of
// truth) — a full projection rebuild would replay created+deleted and
// resurrect the row as isDeleted=true. That's acceptable: cleanup bounds LIVE
// table growth; irreversible event-log purging is data-retention's job
// (pruneEvents), a separate, consumer-lag-guarded path.

import { deleteMany, type WhereObject } from "../db/query";
import { SYSTEM_USER_ID } from "./system-user";
import type { ConfigKeyDefinition, JobDefinition, JobHandlerFn } from "./types/config";

// qualifyEntityName convention (feature:type:kebab-name) with a reserved
// "soft-delete" owner — no real feature owns these; the framework synthesizes
// them. The job-runner keys cron scheduling off the name, the config-resolver
// off the key.
export const SOFT_DELETE_CLEANUP_JOB = "soft-delete:job:cleanup";
export const SOFT_DELETE_GRACE_DAYS_KEY = "soft-delete:config:grace-days";
export const DEFAULT_GRACE_DAYS = 30;

export const softDeleteGraceDaysConfig: ConfigKeyDefinition = {
  type: "number",
  default: DEFAULT_GRACE_DAYS,
  scope: "tenant",
  access: { read: ["TenantAdmin", "SystemAdmin"], write: ["SystemAdmin"] },
  bounds: { min: 0 },
};

export const softDeleteCleanupJob: JobHandlerFn = async (_payload, ctx) => {
  const { db, registry } = ctx;
  if (!db || !registry) {
    throw new Error("soft-delete cleanup: ctx.db + ctx.registry required (JobContext incomplete)");
  }
  // perTenant fan-out → one run per active tenant, systemUser scoped to it.
  // The job's db is the boot DbConnection (NOT tenant-scoped), so every delete
  // is explicitly tenant-filtered below — otherwise a tenant with a short grace
  // would purge another tenant's still-within-grace rows.
  const tenantId = ctx.systemUser?.tenantId ?? ctx._tenantId;
  if (tenantId === undefined) return;

  const resolved = ctx.configResolver
    ? await ctx.configResolver.get(
        SOFT_DELETE_GRACE_DAYS_KEY,
        softDeleteGraceDaysConfig,
        tenantId,
        SYSTEM_USER_ID,
        db,
      )
    : undefined;
  const graceDays = typeof resolved === "number" && resolved >= 0 ? resolved : DEFAULT_GRACE_DAYS;
  const cutoff = Temporal.Now.instant().subtract({ hours: graceDays * 24 });

  for (const proj of registry.getAllProjections().values()) {
    if (proj.isImplicit !== true || typeof proj.source !== "string" || !proj.table) continue;
    const entity = registry.getEntity(proj.source);
    if (!entity?.softDelete) continue;
    const where: WhereObject = { isDeleted: true, deletedAt: { lt: cutoff } };
    // @cast-boundary column-presence probe — identical access the executor's
    // list() does on table["tenantId"] to decide tenant-scoping.
    if ((proj.table as Record<string, unknown>)["tenantId"] !== undefined) {
      where["tenantId"] = tenantId;
    }
    await deleteMany(db, proj.table, where);
  }
};

export function buildSoftDeleteCleanupJob(): JobDefinition {
  return {
    name: SOFT_DELETE_CLEANUP_JOB,
    handler: softDeleteCleanupJob,
    trigger: { cron: "0 3 * * *" },
    perTenant: true,
    concurrency: "skip",
    runIn: "worker",
  };
}
