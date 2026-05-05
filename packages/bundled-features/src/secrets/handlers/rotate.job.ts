// Rotation job. Scans tenant_secrets for rows whose kekVersion is older
// than provider.currentVersion() and rewraps their DEK under the new KEK
// — the ciphertext itself never changes, only the 60-byte DEK wrapper
// and the kek_version column. See architecture/core-secrets.md for the
// full rotation story.
//
// The job is idempotent: re-running it after a partial failure picks up
// the remaining old-version rows. Consumers that want a time-bound run
// pass a maxDurationMs in the payload.
//
// Post-ES pivot: each rotation is an executor.update against the
// tenantSecret aggregate. The resulting `.updated` event carries
// {changes, previous} with BOTH envelopes — useful for a full rotation
// audit trail (when did row X flip from v1 to v2, who triggered it).
// Concurrency-guard shifts from the pre-ES `WHERE kek_version = old`
// check to the executor's stream-version check; a parallel secrets.set
// that landed the row on the new kekVersion first surfaces here as a
// version_conflict error (counted as "skipped", not "failed").

import {
  createEventStoreExecutor,
  createTenantDb,
  type DbConnection,
  type TenantDb,
} from "@cosmicdrift/kumiko-framework/db";
import type { JobHandlerFn, SessionUser, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { rewrapDek } from "@cosmicdrift/kumiko-framework/secrets";
import { ne } from "drizzle-orm";
import { type StoredEnvelope, tenantSecretEntity, tenantSecretsTable } from "../table";

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_MAX_FAILURES = 10;
const SYSTEM_ROLES = ["system"] as const;

const executor = createEventStoreExecutor(tenantSecretsTable, tenantSecretEntity, {
  entityName: "tenant-secret",
});

export type RotateJobPayload = {
  readonly batchSize?: number;
  readonly maxDurationMs?: number;
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

  // Reuse a TenantDb-per-tenant map so we don't rebuild the wrapper for
  // each row in the same tenant. Rotation typically hits one tenant in a
  // batch; the map trims an allocation without adding complexity.
  const tdbCache = new Map<TenantId, TenantDb>();
  function tdbFor(tenantId: TenantId): TenantDb {
    let existing = tdbCache.get(tenantId);
    if (!existing) {
      existing = createTenantDb(db, tenantId, "system");
      tdbCache.set(tenantId, existing);
    }
    return existing;
  }

  while (true) {
    if (ctx.signal?.aborted) {
      stoppedReason = "signal";
      break;
    }
    if (Date.now() >= deadline) {
      stoppedReason = "timeout";
      break;
    }

    const targetVersion = provider.currentVersion();
    const batch = await db
      .select({
        id: tenantSecretsTable.id,
        tenantId: tenantSecretsTable.tenantId,
        version: tenantSecretsTable.version,
        envelope: tenantSecretsTable.envelope,
        kekVersion: tenantSecretsTable.kekVersion,
      })
      .from(tenantSecretsTable)
      .where(ne(tenantSecretsTable.kekVersion, targetVersion))
      .limit(batchSize);

    if (batch.length === 0) break;

    batchesProcessed++;

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

        if (rotated.kekVersion === row.kekVersion) continue;

        const newEnvelope: StoredEnvelope = {
          ciphertext: rotated.ciphertext.toString("base64"),
          iv: rotated.iv.toString("base64"),
          authTag: rotated.authTag.toString("base64"),
          encryptedDek: rotated.encryptedDek.toString("base64"),
          kekVersion: rotated.kekVersion,
        };

        const actor: SessionUser = {
          id: "system",
          tenantId: row.tenantId as TenantId,
          roles: SYSTEM_ROLES,
        };

        const result = await executor.update(
          {
            id: row.id,
            version: row.version,
            changes: {
              envelope: newEnvelope,
              kekVersion: rotated.kekVersion,
            },
          },
          actor,
          tdbFor(row.tenantId as TenantId),
        );

        // version_conflict == another writer (secrets.set or a parallel
        // rotation worker) beat us. Count as "skipped" and move on — the
        // row is already in a valid state, potentially even past target.
        if (!result.isSuccess) {
          if (result.error.code === "version_conflict") continue;
          failed++;
          ctx.log?.warn?.(`[secrets:rotate] executor rejected row ${row.id}`, {
            code: result.error.code,
          });
          continue;
        }
      } catch (err) {
        failed++;
        ctx.log?.warn?.(`[secrets:rotate] failed to rotate row ${row.id}`, { err });
        continue;
      }
      migrated++;
    }

    if (stoppedReason === "too_many_failures") break;
    if (batch.length < batchSize) break;
  }

  const result: RotateJobResult = { migrated, failed, batchesProcessed, stoppedReason };
  ctx.log?.info?.(`[secrets:rotate] complete: ${JSON.stringify(result)}`);
};
