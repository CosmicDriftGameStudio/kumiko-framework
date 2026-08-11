// form-draft cleanup — hard-deletes drafts whose last save is older than a
// configurable retention window (system-wide, one value for the whole
// deployment — form-draft drafts are ephemeral scratch state, not a
// per-tenant compliance policy like data-retention). No perTenant fan-out:
// a single cron run reads the one config value and sweeps the whole table.
// Chunked DELETE (default 1000/batch) keeps lock durations bounded, mirror
// of sessions/handlers/cleanup.job.ts.

import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  type ConfigKeyDefinition,
  createSystemConfig,
  type JobHandlerFn,
  SYSTEM_TENANT_ID,
  SYSTEM_USER_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { deleteDraftsByIds, selectStaleDraftsBatch } from "../db/queries/cleanup";
import { filterOwnedStorageKeys } from "../db/queries/owned-file-refs";
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
  const retentionDays =
    typeof resolved === "number" && resolved >= 1 ? resolved : FORM_DRAFT_DEFAULT_RETENTION_DAYS;

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
      const keys = collectDraftFileRefKeys(row.draft);
      // skip: no FileRefs in this row's blob — nothing to release.
      if (keys.length === 0) continue;
      if (!fileProviderResolver) {
        // skip: no resolver wired (files feature not mounted) — row still
        // gets deleted below, but its FileRefs leak as storage orphans.
        ctx.log?.warn?.(
          `[form-draft:cleanup] tenant=${row.tenantId} has ${keys.length} FileRef(s) but no _fileProviderResolver is wired — row will be deleted without releasing storage`,
        );
        continue;
      }

      try {
        // Only storageKeys with a real file_refs row owned by this row's
        // draft owner are releasable — `draft.values` is free-form JSON the
        // owning user controls, so an unverified key could target someone
        // else's file (see db/queries/owned-file-refs.ts).
        const ownedKeys = await filterOwnedStorageKeys(db, row.tenantId, row.ownerId, keys);
        const provider = await fileProviderResolver(row.tenantId);
        await releaseDraftFileRefs(ownedKeys, (key) => provider.delete(key), ctx.log);
      } catch (err) {
        ctx.log?.warn?.(
          `[form-draft:cleanup] no file provider resolvable for tenant=${row.tenantId} — FileRefs NOT released (row still deleted): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const batchDeleted = await deleteDraftsByIds(
      db,
      batch.map((row) => row.id),
    );
    deleted += batchDeleted;
    if (batchDeleted === 0 || batch.length < DEFAULT_BATCH_SIZE) break;
  }
  ctx.log?.info?.(`[form-draft:cleanup] deleted=${deleted} retentionDays=${retentionDays}`);
};
