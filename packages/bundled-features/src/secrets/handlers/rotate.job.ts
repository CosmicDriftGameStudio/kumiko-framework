// Rotation job. Scans tenant_secrets for rows whose kekVersion is older
// than provider.currentVersion() and rewraps their DEK under the new KEK
// — the ciphertext itself never changes, only the 60-byte DEK wrapper
// and the kek_version column. See architecture/core-secrets.md for the
// full rotation story.
//
// The job is idempotent: re-running it after a partial failure picks up
// the remaining old-version rows. Consumers that want a time-bound run
// pass a maxDurationMs in the payload.

import type { DbConnection } from "@kumiko/framework/db";
import type { JobHandlerFn } from "@kumiko/framework/engine";
import { InternalError } from "@kumiko/framework/errors";
import { rewrapDek } from "@kumiko/framework/secrets";
import { and, eq, ne } from "drizzle-orm";
import { tenantSecretsTable } from "../table";

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_MAX_FAILURES = 10;

export type RotateJobPayload = {
  // Cap on the batch size fetched per iteration. Tuning knob for ops —
  // smaller batches hold each TX shorter, larger batches amortise the
  // roundtrip. Default 100 fits most cases.
  readonly batchSize?: number;
  // Optional hard cap on run duration. Useful when chaining into a
  // maintenance window; omitting it lets the job run until empty.
  readonly maxDurationMs?: number;
  // Circuit-breaker: bail out after N consecutive row-level failures in
  // a single run. A systematic breakage (KEK bytes corrupt, DB constraint
  // violation on every row) would otherwise spray the log with thousands
  // of identical warns while making zero progress. Default 10 — first
  // few let sporadic DB-conflicts retry next run, but a real problem
  // halts early.
  readonly maxFailures?: number;
};

export type RotateJobResult = {
  readonly migrated: number;
  readonly failed: number;
  readonly batchesProcessed: number;
  readonly stoppedReason: "empty" | "timeout" | "signal" | "too_many_failures";
};

export const rotateJob: JobHandlerFn = async (rawPayload, ctx): Promise<void> => {
  const payload = rawPayload as RotateJobPayload;
  if (!ctx.masterKeyProvider) {
    throw new InternalError({
      message:
        "[secrets:rotate] ctx.masterKeyProvider missing — wire it via extraContext.masterKeyProvider at boot.",
    });
  }
  const provider = ctx.masterKeyProvider;
  if (!ctx.db) {
    throw new InternalError({
      message: "[secrets:rotate] ctx.db missing — job context requires a database connection.",
    });
  }
  const db = ctx.db as DbConnection;
  const batchSize = payload.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxFailures = payload.maxFailures ?? DEFAULT_MAX_FAILURES;
  const deadline = payload.maxDurationMs
    ? Date.now() + payload.maxDurationMs
    : Number.POSITIVE_INFINITY;

  let migrated = 0;
  let failed = 0;
  let batchesProcessed = 0;
  let stoppedReason: RotateJobResult["stoppedReason"] = "empty";

  while (true) {
    if (ctx.signal?.aborted) {
      stoppedReason = "signal";
      break;
    }
    if (Date.now() >= deadline) {
      stoppedReason = "timeout";
      break;
    }

    // Fetch a batch of rows not yet on the current KEK version. The index
    // on kek_version keeps this scan cheap even when the table is large.
    const targetVersion = provider.currentVersion();
    const batch = await db
      .select({
        id: tenantSecretsTable.id,
        envelope: tenantSecretsTable.envelope,
        kekVersion: tenantSecretsTable.kekVersion,
      })
      .from(tenantSecretsTable)
      .where(and(ne(tenantSecretsTable.kekVersion, targetVersion)))
      .limit(batchSize);

    if (batch.length === 0) break;

    batchesProcessed++;

    // Circuit-breaker: checked BEFORE each row so we don't pick another
    // batch after hitting the failure threshold. Outer-loop guard below
    // bails the whole run.
    if (failed >= maxFailures) {
      stoppedReason = "too_many_failures";
      break;
    }

    for (const row of batch) {
      if (failed >= maxFailures) {
        stoppedReason = "too_many_failures";
        break;
      }
      try {
        const oldEnvelope = {
          ciphertext: Buffer.from(row.envelope.ciphertext, "base64"),
          iv: Buffer.from(row.envelope.iv, "base64"),
          authTag: Buffer.from(row.envelope.authTag, "base64"),
          encryptedDek: Buffer.from(row.envelope.encryptedDek, "base64"),
          kekVersion: row.envelope.kekVersion,
        };
        const rotated = await rewrapDek(oldEnvelope, provider);

        // rewrapDek returns the same object if already current — unlikely
        // here because our WHERE excluded current rows, but defensive.
        if (rotated.kekVersion === row.kekVersion) continue;

        // Concurrency guard: only rotate when the row's kek_version is still
        // the pre-rotation value. A parallel secrets.set would have landed
        // the row on currentVersion already — we must not clobber it with
        // stale wrapped bytes. returning() reports 0 rows when the guard
        // rejected the update; we count that as "moved on, not a failure".
        const updated = await db
          .update(tenantSecretsTable)
          .set({
            envelope: {
              ciphertext: rotated.ciphertext.toString("base64"),
              iv: rotated.iv.toString("base64"),
              authTag: rotated.authTag.toString("base64"),
              encryptedDek: rotated.encryptedDek.toString("base64"),
              kekVersion: rotated.kekVersion,
            },
            kekVersion: rotated.kekVersion,
          })
          .where(
            and(
              eq(tenantSecretsTable.id, row.id),
              eq(tenantSecretsTable.kekVersion, row.kekVersion),
            ),
          )
          .returning({ id: tenantSecretsTable.id });
        if (updated.length === 0) continue;
      } catch (err) {
        failed++;
        ctx.log?.warn?.(`[secrets:rotate] failed to rotate row ${row.id}`, { err });
        continue;
      }
      migrated++;
    }

    // Bail out of the outer loop if the circuit-breaker tripped during
    // the inner row loop.
    if (stoppedReason === "too_many_failures") break;

    // If we got a smaller-than-batchSize batch, we've drained the backlog.
    if (batch.length < batchSize) break;
  }

  // Log the summary — BullMQ jobs don't surface return values outside the
  // worker, so stdout + ctx.log is the observable signal for ops. Tests
  // query the actual DB state (kekVersion) to assert success.
  const result: RotateJobResult = { migrated, failed, batchesProcessed, stoppedReason };
  ctx.log?.info?.(`[secrets:rotate] complete: ${JSON.stringify(result)}`);
};
