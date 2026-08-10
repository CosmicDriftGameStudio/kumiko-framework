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
import { deleteStaleDraftsBatch } from "../db/queries/cleanup";

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

  let deleted = 0;
  while (true) {
    const batchDeleted = await deleteStaleDraftsBatch(db, retentionDays, DEFAULT_BATCH_SIZE);
    deleted += batchDeleted;
    if (batchDeleted < DEFAULT_BATCH_SIZE) break;
  }
  ctx.log?.info?.(`[form-draft:cleanup] deleted=${deleted} retentionDays=${retentionDays}`);
};
