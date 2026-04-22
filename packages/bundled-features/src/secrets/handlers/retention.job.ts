// Retention job for tenant_secret_reads. Audit rows are append-only during
// normal operation — without cleanup the table grows by 1 row per
// ctx.secrets.get call, which adds up fast on busy apps (an hourly billing
// cron reading stripe.apiKey = ~8k rows/year per tenant). Most compliance
// regimes require keeping audit-logs for a defined window (90d-7y); older
// rows are safe to purge.
//
// Defaults: 90 days keep-window. Ops overrides via payload when they need
// a different retention (e.g. 365 for SOC2, 7 for dev environments).

import type { DbConnection } from "@kumiko/framework/db";
import type { JobHandlerFn } from "@kumiko/framework/engine";
import { InternalError } from "@kumiko/framework/errors";
import { lt, sql } from "drizzle-orm";
import { tenantSecretsAuditTable } from "../table";

const DEFAULT_OLDER_THAN_DAYS = 90;
const DEFAULT_BATCH_SIZE = 1000;

export type RetentionJobPayload = {
  // Delete audit rows whose read_at is older than this many days. Default
  // 90. Pass 0 to delete everything (testing / emergency wipe) — the
  // explicit 0 avoids accidental-wipe from a forgotten field.
  readonly olderThanDays?: number;
  // Rows per DELETE batch. Keeps lock duration bounded on busy tables.
  readonly batchSize?: number;
  // Hard cap on run duration. Omit to run until empty.
  readonly maxDurationMs?: number;
};

export type RetentionJobResult = {
  readonly deleted: number;
  readonly batchesProcessed: number;
  readonly stoppedReason: "empty" | "timeout" | "signal";
};

export const retentionJob: JobHandlerFn = async (rawPayload, ctx): Promise<void> => {
  const payload = rawPayload as RetentionJobPayload;
  if (!ctx.db) {
    throw new InternalError({
      message: "[secrets:retention] ctx.db missing — job context requires a database connection.",
    });
  }
  const db = ctx.db as DbConnection;
  // Coerce + validate the payload inputs. BullMQ delivers payloads as
  // opaque JSON — TS types don't survive the wire, so a malformed
  // `olderThanDays: "90; DROP TABLE …"` would otherwise land directly
  // in a sql.raw() interpolation. Coercing to a finite non-negative
  // integer before building SQL closes that door.
  const olderThanDaysRaw = payload.olderThanDays ?? DEFAULT_OLDER_THAN_DAYS;
  const olderThanDays = Number(olderThanDaysRaw);
  if (!Number.isFinite(olderThanDays) || olderThanDays < 0 || !Number.isInteger(olderThanDays)) {
    throw new InternalError({
      message: `[secrets:retention] olderThanDays must be a non-negative integer (got ${String(olderThanDaysRaw)})`,
    });
  }
  const batchSize = payload.batchSize ?? DEFAULT_BATCH_SIZE;
  const deadline = payload.maxDurationMs
    ? Date.now() + payload.maxDurationMs
    : Number.POSITIVE_INFINITY;

  let deleted = 0;
  let batchesProcessed = 0;
  let stoppedReason: RetentionJobResult["stoppedReason"] = "empty";

  // Cutoff: compute once per run. The days value is a parameter-bound
  // integer multiplied against a fixed interval literal — no string
  // interpolation with user-controlled values touches the query.
  const cutoff = sql`now() - (${olderThanDays} * interval '1 day')`;

  while (true) {
    if (ctx.signal?.aborted) {
      stoppedReason = "signal";
      break;
    }
    if (Date.now() >= deadline) {
      stoppedReason = "timeout";
      break;
    }

    // Delete-by-id-subquery so we can bound the batch. A single unlimited
    // DELETE on a multi-million-row table holds a long lock; chunking
    // keeps each DELETE short and ops-friendly.
    const rows = await db
      .delete(tenantSecretsAuditTable)
      .where(
        sql`${tenantSecretsAuditTable.id} in (
          select ${tenantSecretsAuditTable.id}
          from ${tenantSecretsAuditTable}
          where ${lt(tenantSecretsAuditTable.readAt, cutoff)}
          limit ${batchSize}
        )`,
      )
      .returning({ id: tenantSecretsAuditTable.id });

    if (rows.length === 0) break;

    deleted += rows.length;
    batchesProcessed++;

    // Smaller-than-batch-size → backlog drained.
    if (rows.length < batchSize) break;
  }

  const result: RetentionJobResult = { deleted, batchesProcessed, stoppedReason };
  ctx.log?.info?.(`[secrets:retention] complete: ${JSON.stringify(result)}`);
};
