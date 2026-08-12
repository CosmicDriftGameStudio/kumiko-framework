// form-draft cleanup — hard-deletes drafts whose last save is older than a
// configurable retention window (system-wide, one value for the whole
// deployment — form-draft drafts are ephemeral scratch state, not a
// per-tenant compliance policy like data-retention). No perTenant fan-out:
// a single cron run reads the one config value and sweeps the whole table.
// Chunked DELETE (default 1000/batch) keeps lock durations bounded, mirror
// of sessions/handlers/cleanup.job.ts.

import { createTenantDb, type DbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  type AppContext,
  access,
  type ConfigKeyDefinition,
  createSystemConfig,
  createSystemUser,
  type JobHandlerFn,
  SYSTEM_TENANT_ID,
  SYSTEM_USER_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { type StaleDraftRow, selectStaleDraftsBatch } from "../db/queries/cleanup";
import { filterOwnedStorageKeys } from "../db/queries/owned-file-refs";
import { formDraftExecutor } from "../executor";
import { collectDraftFileRefKeys, releaseDraftFileRefs } from "../release-file-refs";

export const FORM_DRAFT_RETENTION_DAYS_CONFIG_KEY = "form-draft:config:retention-days";
export const FORM_DRAFT_DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_BATCH_SIZE = 1000;

export const formDraftRetentionDaysConfig: ConfigKeyDefinition<"number"> = createSystemConfig(
  "number",
  {
    default: FORM_DRAFT_DEFAULT_RETENTION_DAYS,
    bounds: { min: 1 },
    write: access.systemAdmin,
    read: access.admin,
  },
);

async function releaseRowFileRefs(
  row: StaleDraftRow,
  db: DbConnection,
  fileProviderResolver: AppContext["_fileProviderResolver"],
  log: AppContext["log"],
): Promise<void> {
  const keys = collectDraftFileRefKeys(row.draft);
  // skip: no FileRefs in this row's blob — nothing to release.
  if (keys.length === 0) return;
  if (!fileProviderResolver) {
    // skip: no resolver wired (files feature not mounted) — row still
    // gets deleted below, but its FileRefs leak as storage orphans.
    log?.warn?.(
      `[form-draft:cleanup] tenant=${row.tenantId} has ${keys.length} FileRef(s) but no _fileProviderResolver is wired — row will be deleted without releasing storage`,
    );
    // skip: warning already logged above — nothing more to do for this row.
    return;
  }

  // Only storageKeys with a real file_refs row owned by this row's draft
  // owner are releasable — `draft.values` is free-form JSON the owning user
  // controls, so an unverified key could target someone else's file (see
  // db/queries/owned-file-refs.ts). Not wrapped in try/catch: a query
  // failure here (pool exhaustion, missing table) is a real error, not the
  // "no provider resolvable" case below — let it propagate so the job retries.
  const ownedKeys = await filterOwnedStorageKeys(
    db,
    row.tenantId,
    row.ownerId,
    keys,
    row.insertedAt,
  );

  try {
    const provider = await fileProviderResolver(row.tenantId);
    await releaseDraftFileRefs(ownedKeys, (key) => provider.delete(key), log);
  } catch (err) {
    log?.warn?.(
      `[form-draft:cleanup] no file provider resolvable for tenant=${row.tenantId} — FileRefs NOT released (row still deleted): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// A stale-drafts batch spans arbitrary tenants (this job sweeps the whole
// table under SYSTEM_TENANT_ID, not per-tenant) — group by tenant so each
// tenant's rows get deleted through a tenant-scoped db + system user, one
// event-store delete per row rather than a raw cross-tenant DELETE.
export function groupStaleDraftIdsByTenant(
  batch: readonly StaleDraftRow[],
): ReadonlyMap<TenantId, readonly string[]> {
  const grouped = new Map<TenantId, string[]>();
  for (const row of batch) {
    const ids = grouped.get(row.tenantId);
    if (ids) ids.push(row.id);
    else grouped.set(row.tenantId, [row.id]);
  }
  return grouped;
}

// Raw `DELETE FROM read_form_drafts` would bypass the event store entirely
// — a projection rebuild/replay has no `deleted` event to apply and the row
// resurrects, PII included. formDraftExecutor.delete() is the event-sourced
// path; it needs a tenant-scoped db + a SessionUser, so rows are grouped by
// tenant first (see groupStaleDraftIdsByTenant above).
async function deleteStaleDraftsBatch(
  batch: readonly StaleDraftRow[],
  db: DbConnection,
  log: AppContext["log"],
): Promise<number> {
  let deleted = 0;
  for (const [tenantId, ids] of groupStaleDraftIdsByTenant(batch)) {
    const systemUser = createSystemUser(tenantId);
    const tenantDb = createTenantDb(db, tenantId, "system");
    for (const id of ids) {
      const result = await formDraftExecutor.delete({ id }, systemUser, tenantDb);
      if (result.isSuccess) {
        deleted++;
      } else {
        log?.warn?.(
          `[form-draft:cleanup] failed to delete stale draft id=${id} tenant=${tenantId}: ${result.error.message}`,
        );
      }
    }
  }
  return deleted;
}

export const cleanupDraftsJob: JobHandlerFn = async (_payload, ctx) => {
  if (!ctx.db || !ctx.registry) {
    throw new InternalError({
      message: "[form-draft:cleanup] ctx.db + ctx.registry required (JobContext incomplete)",
    });
  }
  const db = ctx.db as DbConnection;

  const resolved = ctx.configResolver
    ? await ctx.configResolver.get(
        FORM_DRAFT_RETENTION_DAYS_CONFIG_KEY,
        formDraftRetentionDaysConfig,
        SYSTEM_TENANT_ID,
        SYSTEM_USER_ID,
        db,
      )
    : undefined;
  const isValidRetention = typeof resolved === "number" && resolved >= 1;
  // configResolver missing is the legitimate no-config case (r.optionalRequires,
  // see feature.ts) — nothing to warn about there. A resolver that IS wired but
  // returns something unusable means an admin set an invalid value.
  if (ctx.configResolver && !isValidRetention) {
    ctx.log?.warn?.(
      `[form-draft:cleanup] configResolver returned invalid retention-days value=${String(resolved)} — falling back to default=${FORM_DRAFT_DEFAULT_RETENTION_DAYS}`,
    );
  }
  const retentionDays = isValidRetention ? resolved : FORM_DRAFT_DEFAULT_RETENTION_DAYS;

  const fileProviderResolver = ctx._fileProviderResolver;

  let deleted = 0;
  while (true) {
    const batch = await selectStaleDraftsBatch(db, retentionDays, DEFAULT_BATCH_SIZE);
    if (batch.length === 0) break;

    // Rows span arbitrary tenants (this job sweeps the whole table under
    // SYSTEM_TENANT_ID, not per-tenant) — ctx.files is resolved for a single
    // tenant per job run and would be wrong here, so each row resolves its
    // own tenant's provider via _fileProviderResolver instead. Skipped
    // entirely for rows with no FileRefs in the blob, the common case.
    for (const row of batch) {
      await releaseRowFileRefs(row, db, fileProviderResolver, ctx.log);
    }

    const batchDeleted = await deleteStaleDraftsBatch(batch, db, ctx.log);
    deleted += batchDeleted;
    if (batchDeleted === 0 || batch.length < DEFAULT_BATCH_SIZE) break;
  }
  ctx.log?.info?.(`[form-draft:cleanup] deleted=${deleted} retentionDays=${retentionDays}`);
};
