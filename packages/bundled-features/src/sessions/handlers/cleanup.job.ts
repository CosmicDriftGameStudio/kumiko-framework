// Retention/cleanup job for user_sessions. Without this the table grows
// monotonically: every login adds one row, logout only flips revokedAt. A
// long-lived app would eventually accumulate millions of dead rows that
// slow the sessionChecker point-read down and bloat backups.
//
// Policy:
//   - Delete rows whose expiresAt is older than `olderThanDays` (default
//     30d). Expired sessions can never go live again; the audit trail
//     isn't useful past the retention window.
//   - Delete rows whose revokedAt is older than `olderThanDays`. Same
//     reasoning: a session revoked months ago has no operational value.
//   - NEVER delete currently-live rows. Safe by construction — the WHERE
//     clause requires either expiresAt OR revokedAt to be past-cutoff.
//
// Chunked DELETE (default 1000/batch) keeps lock durations bounded. Ops
// schedules this daily (manual trigger by default — opt-in to cron in the
// app's feature-wiring so a dev environment doesn't churn through a fresh
// seed). Mirror of secrets/retention.job in shape.

import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { JobHandlerFn } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { deleteStaleSessionsBatch } from "../db/queries/cleanup";

const DEFAULT_OLDER_THAN_DAYS = 30;
const DEFAULT_BATCH_SIZE = 1000;

export type SessionCleanupPayload = {
  readonly olderThanDays?: number;
  readonly batchSize?: number;
  readonly maxDurationMs?: number;
};

export type SessionCleanupResult = {
  readonly deleted: number;
  readonly batchesProcessed: number;
  readonly stoppedReason: "empty" | "timeout" | "signal";
};

export const cleanupJob: JobHandlerFn = async (rawPayload, ctx): Promise<void> => {
  const payload = rawPayload as SessionCleanupPayload; // @cast-boundary engine-payload
  if (!ctx.db) {
    throw new InternalError({
      message: "[sessions:cleanup] ctx.db missing — job context requires a database connection.",
    });
  }
  const db = ctx.db as DbConnection;

  const olderThanDaysRaw = payload.olderThanDays ?? DEFAULT_OLDER_THAN_DAYS;
  const olderThanDays = Number(olderThanDaysRaw);
  if (!Number.isFinite(olderThanDays) || olderThanDays < 0 || !Number.isInteger(olderThanDays)) {
    throw new InternalError({
      message: `[sessions:cleanup] olderThanDays must be a non-negative integer (got ${String(olderThanDaysRaw)})`,
    });
  }
  const batchSize = payload.batchSize ?? DEFAULT_BATCH_SIZE;
  const deadline = payload.maxDurationMs
    ? Date.now() + payload.maxDurationMs
    : Number.POSITIVE_INFINITY;

  let deleted = 0;
  let batchesProcessed = 0;
  let stoppedReason: SessionCleanupResult["stoppedReason"] = "empty";

  while (true) {
    if (ctx.signal?.aborted) {
      stoppedReason = "signal";
      break;
    }
    if (Date.now() >= deadline) {
      stoppedReason = "timeout";
      break;
    }

    const batchDeleted = await deleteStaleSessionsBatch(db, olderThanDays, batchSize);
    if (batchDeleted === 0) break;

    deleted += batchDeleted;
    batchesProcessed++;

    if (batchDeleted < batchSize) break;
  }

  const result: SessionCleanupResult = { deleted, batchesProcessed, stoppedReason };
  ctx.log?.info?.(`[sessions:cleanup] complete: ${JSON.stringify(result)}`);
};
