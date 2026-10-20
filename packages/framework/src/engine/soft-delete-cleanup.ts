// Auto-generated soft-delete maintenance. Hard-deletes entity rows that have
// been soft-deleted longer than the per-tenant grace period. Injected into the
// registry (the job + its config key) whenever ANY entity opts into softDelete
// — see createRegistry. Runtime twin to the auto restore-handler: softDelete:
// true buys an entity restore + trash (ctx.includeDeleted) + this cleanup, with
// no feature to wire.
//
// Each expired row is purged through the executor's forget verb: the `<entity>.forgotten`
// event replays on a projection rebuild, so the purged row stays gone. The earlier events stay
// in the log; irreversible event-log purging is data-retention's job (pruneEvents), a separate,
// consumer-lag-guarded path.

import { createEventStoreExecutor, type EventStoreExecutor } from "../db/event-store-executor.ts";
import { asEntityTableMeta, selectMany, type WhereObject } from "../db/query.ts";
import { hasFieldProperty } from "../db/table-introspection.ts";
import { reraiseAsKumikoError } from "../errors/index.ts";
import { purgeExpiredFileRefsWithBytes } from "../files/purge-expired-file-ref-bytes.ts";
import { FILE_REF_ENTITY_NAME } from "../files/types.ts";
import { createSystemUser, SYSTEM_USER_ID } from "./system-user.ts";
import type { ConfigKeyDefinition, JobDefinition, JobHandlerFn } from "./types/config.ts";
import { SYSTEM_TENANT_ID } from "./types/identifiers.ts";
import type { EntityDefinition, SessionUser } from "./types/index.ts";

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
  return hasFieldProperty(table, "tenantId");
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

function isGlobalTenancyTable(table: unknown): boolean {
  return asEntityTableMeta(table)?.tenancy === "global";
}

async function resolveGraceDays(
  ctx: Pick<JobContext, "configResolver">,
  tenantId: string,
  db: NonNullable<JobContext["db"]>,
): Promise<number> {
  const resolved = await ctx.configResolver?.get(
    SOFT_DELETE_GRACE_DAYS_KEY,
    softDeleteGraceDaysConfig,
    tenantId,
    SYSTEM_USER_ID,
    db,
  );
  return typeof resolved === "number" && resolved >= 1 ? resolved : DEFAULT_GRACE_DAYS;
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

  const graceDays = await resolveGraceDays(ctx, tenantId, db);
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
    const executor = createEventStoreExecutor(proj.table, entity, { entityName: proj.source });
    await purgeExpiredRows(
      { db, executor, user: ctx.systemUser ?? createSystemUser(tenantId) },
      proj.source,
      proj.table,
      where,
      cutoff,
      ctx,
    );
  }
};

type JobContext = Parameters<JobHandlerFn>[1];
type PurgeTable = Parameters<typeof selectMany>[1];
type PurgeWriter = {
  readonly db: NonNullable<JobContext["db"]>;
  readonly executor: EventStoreExecutor;
  readonly user: SessionUser;
};

const PURGE_PAGE_SIZE = 500;

async function forgetRow(writer: PurgeWriter, id: string): Promise<void> {
  // ponytail: one append per expired row, batch when purge volume needs it
  const result = await writer.executor.forget({ id }, writer.user, writer.db);
  if (!result.isSuccess) throw reraiseAsKumikoError(result.error);
}

async function purgeExpiredRows(
  writer: PurgeWriter,
  source: string,
  table: PurgeTable,
  where: WhereObject,
  cutoff: Temporal.Instant,
  ctx: Pick<JobContext, "files" | "log">,
  readDb: unknown = writer.db,
): Promise<void> {
  if (source === FILE_REF_ENTITY_NAME) {
    // The row is the only record of the storageKey, so its bytes go first.
    return await purgeExpiredFileRefsWithBytes({
      db: writer.db,
      table,
      where,
      expiredBefore: cutoff,
      files: ctx.files,
      log: ctx.log,
      forgetRow: (id) => forgetRow(writer, id),
    });
  }
  await forgetExpiredPages(writer, source, table, where, ctx, readDb);
}

// Keyset on id: a row whose forget fails is logged and skipped, it must not hide the rows behind it.
async function forgetExpiredPages(
  writer: PurgeWriter,
  source: string,
  table: PurgeTable,
  where: WhereObject,
  ctx: Pick<JobContext, "log">,
  readDb: unknown,
): Promise<void> {
  let afterId: string | undefined;
  for (;;) {
    const page = await selectMany<{ id: string }>(
      readDb,
      table,
      { ...where, ...(afterId === undefined ? {} : { id: { gt: afterId } }) },
      { orderBy: { col: "id", direction: "asc" }, limit: PURGE_PAGE_SIZE },
    );
    const last = page[page.length - 1];
    if (last === undefined) break;
    for (const row of page) {
      try {
        await forgetRow(writer, row.id);
      } catch (err) {
        ctx.log?.warn(
          `[soft-delete-cleanup] ${source} ${row.id} not purged: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    afterId = last.id;
  }
}

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
    const writer: PurgeWriter = {
      db,
      executor: createEventStoreExecutor(proj.table, entity, { entityName: proj.source }),
      user: ctx.systemUser ?? createSystemUser(SYSTEM_TENANT_ID),
    };
    // A global-tenancy table is invisible to a tenant-mode ctx.db, so its candidates are read unscoped.
    await purgeExpiredRows(
      writer,
      proj.source,
      proj.table,
      where,
      cutoff,
      ctx,
      isGlobalTenancyTable(proj.table) ? db.unsafeRaw() : db,
    );
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
      grants: ["unsafeRaw"],
    },
  };
}
