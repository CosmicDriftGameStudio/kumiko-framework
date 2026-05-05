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
import { or, sql } from "drizzle-orm";
import { userSessionTable } from "../schema/user-session";

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
  const payload = rawPayload as SessionCleanupPayload;
  if (!ctx.db) {
    throw new InternalError({
      message: "[sessions:cleanup] ctx.db missing — job context requires a database connection.",
    });
  }
  const db = ctx.db as DbConnection;

  // Coerce-and-validate: BullMQ payloads arrive as opaque JSON, so TS types
  // don't survive. Guard before the value is interpolated into SQL.
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

  const cutoff = sql`now() - (${olderThanDays} * interval '1 day')`;

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

    // DELETE-by-id-subquery with an explicit LIMIT so the lock stays short.
    // The WHERE clause is the safety net: we only touch rows that are
    // PAST-CUTOFF (expired OR revoked), never currently-live sessions. A
    // null-check in PG semantics: `x < cutoff` already excludes null.
    const rows = await db
      .delete(userSessionTable)
      .where(
        sql`${userSessionTable["id"]} in (
          select ${userSessionTable["id"]}
          from ${userSessionTable}
          where ${or(
            sql`${userSessionTable["expiresAt"]} < ${cutoff}`,
            sql`${userSessionTable["revokedAt"]} < ${cutoff}`,
          )}
          limit ${batchSize}
        )`,
      )
      .returning({ id: userSessionTable["id"] });

    if (rows.length === 0) break;

    deleted += rows.length;
    batchesProcessed++;

    if (rows.length < batchSize) break;
  }

  const result: SessionCleanupResult = { deleted, batchesProcessed, stoppedReason };
  ctx.log?.info?.(`[sessions:cleanup] complete: ${JSON.stringify(result)}`);
};
