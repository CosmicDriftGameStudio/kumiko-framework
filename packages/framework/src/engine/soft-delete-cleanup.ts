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

import type { SchemaTable } from "@cosmicdrift/kumiko-types/schema-table-types";
import type { TenancyBrand } from "@cosmicdrift/kumiko-types/tenancy-brand";
import { asEntityTableMeta, deleteMany, type WhereObject } from "../db/query.js";
import { SYSTEM_USER_ID } from "./system-user.js";
import type { ConfigKeyDefinition, JobDefinition, JobHandlerFn } from "./types/config.js";
import type { EntityDefinition } from "./types/index.js";

// qualifyEntityName convention (feature:type:kebab-name) with a reserved
// "soft-delete" owner — no real feature owns these; the framework synthesizes
// them. The job-runner keys cron scheduling off the name, the config-resolver
// off the key.
export const SOFT_DELETE_CLEANUP_JOB = "soft-delete:job:cleanup";
export const SOFT_DELETE_CLEANUP_SYSTEM_JOB = "soft-delete:job:cleanup-system";
export const SOFT_DELETE_GRACE_DAYS_KEY = "soft-delete:config:grace-days";
export const DEFAULT_GRACE_DAYS = 30;

export const softDeleteGraceDaysConfig: ConfigKeyDefinition = {
  type: "number",
  default: DEFAULT_GRACE_DAYS,
  scope: "tenant",
  access: { read: ["TenantAdmin", "SystemAdmin"], write: ["SystemAdmin"] },
  // min: 1, not 0 (565/2) — graceDays: 0 doesn't mean "no cleanup", it means
  // "hard-delete every currently soft-deleted row on the next cron run".
  // Clamping (not rejecting) keeps the resolve-config-or-param clamp path's
  // existing silent-below-bound / audited-crossing behavior.
  bounds: { min: 1 },
};

function hasTenantIdColumn(table: unknown): boolean {
  return (table as Record<string, unknown>)["tenantId"] !== undefined;
}

// The entity declaration decides, not the column: a `tenancy: "global"` table
// (e.g. user) still carries a tenantId column (SYSTEM_TENANT_ID), yet no
// tenant-mode delete can ever match its rows.
export function isSystemScopedSoftDeleteTable(
  table: unknown,
  entity: Pick<EntityDefinition, "tenancy">,
): boolean {
  return entity.tenancy === "global" || !hasTenantIdColumn(table);
}

function isGlobalTenancyTable(table: unknown): table is SchemaTable & TenancyBrand<"global"> {
  return asEntityTableMeta(table)?.tenancy === "global";
}

export const softDeleteCleanupJob: JobHandlerFn = async (_payload, ctx) => {
  const { db, registry } = ctx;
  if (!db || !registry) {
    throw new Error("soft-delete cleanup: ctx.db + ctx.registry required (JobContext incomplete)");
  }
  // perTenant fan-out → one run per active tenant, systemUser scoped to it.
  // The job's db is a tenant-filtered TenantDb, but every delete is still
  // explicitly tenant-filtered below as defense-in-depth — otherwise a
  // tenant with a short grace would purge another tenant's still-within-grace
  // rows.
  const tenantId = ctx.systemUser?.tenantId ?? ctx._tenantId;
  if (tenantId === undefined) {
    // skip: cron fired without a perTenant fan-out tenant — nothing scoped to purge
    return;
  }

  const resolved = ctx.configResolver
    ? await ctx.configResolver.get(
        SOFT_DELETE_GRACE_DAYS_KEY,
        softDeleteGraceDaysConfig,
        tenantId,
        SYSTEM_USER_ID,
        db,
      )
    : undefined;
  const graceDays = typeof resolved === "number" && resolved >= 1 ? resolved : DEFAULT_GRACE_DAYS;
  const cutoff = Temporal.Now.instant().subtract({ hours: graceDays * 24 });

  for (const proj of registry.getAllProjections().values()) {
    if (proj.isImplicit !== true || typeof proj.source !== "string" || !proj.table) continue;
    const entity = registry.getEntity(proj.source);
    if (!entity?.softDelete) continue;
    // System-global entities (tenancy "global" or no tenantId column, e.g. `user`) are NOT swept
    // here: this handler runs once PER TENANT, so a tenant-scoped grace value
    // would purge every OTHER tenant's still-within-grace rows too (effective
    // grace = min() across all tenants). softDeleteCleanupSystemJob handles
    // these separately, once, with a fixed grace period.
    if (isSystemScopedSoftDeleteTable(proj.table, entity)) continue;
    const where: WhereObject = { isDeleted: true, deletedAt: { lt: cutoff }, tenantId };
    await deleteMany(db, proj.table, where);
  }
};

// System-global soft-deleted entities (tenancy "global" or no tenantId column) can't take a
// per-tenant grace period — there's no "this tenant's view" of a row that
// isn't scoped to any tenant. Runs once (not perTenant) with a fixed grace
// period; a future system-scope config key could make this configurable
// without reintroducing the per-tenant-fanout bug.
export const softDeleteCleanupSystemJob: JobHandlerFn = async (_payload, ctx) => {
  const { db, registry } = ctx;
  if (!db || !registry) {
    throw new Error(
      "soft-delete system cleanup: ctx.db + ctx.registry required (JobContext incomplete)",
    );
  }
  const cutoff = Temporal.Now.instant().subtract({ hours: DEFAULT_GRACE_DAYS * 24 });
  for (const proj of registry.getAllProjections().values()) {
    if (proj.isImplicit !== true || typeof proj.source !== "string" || !proj.table) continue;
    const entity = registry.getEntity(proj.source);
    if (!entity?.softDelete) continue;
    if (!isSystemScopedSoftDeleteTable(proj.table, entity)) continue;
    const where: WhereObject = { isDeleted: true, deletedAt: { lt: cutoff } };
    if (isGlobalTenancyTable(proj.table)) {
      await db.global(proj.table).deleteMany(where);
    } else {
      await deleteMany(db, proj.table, where);
    }
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

export function buildSoftDeleteCleanupSystemJob(): JobDefinition {
  return {
    name: SOFT_DELETE_CLEANUP_SYSTEM_JOB,
    handler: softDeleteCleanupSystemJob,
    trigger: { cron: "15 3 * * *" },
    concurrency: "skip",
    runIn: "worker",
    escapeHatch: {
      reason:
        "hard-deletes expired soft-deleted rows of global entities (e.g. user) once, system-wide",
      grants: ["globalWrites"],
    },
  };
}
