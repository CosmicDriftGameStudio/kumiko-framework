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

import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  createEventStoreExecutor,
  createTenantDb,
  type DbConnection,
  type TenantDb,
} from "@cosmicdrift/kumiko-framework/db";
import type { JobHandlerFn, SessionUser, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import {
  decodeStoredEnvelope,
  encodeStoredEnvelope,
  rewrapDek,
} from "@cosmicdrift/kumiko-framework/secrets";
import {
  type ChunkedMigrationStopReason,
  runChunkedMigration,
} from "../../shared";
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
  readonly stoppedReason: ChunkedMigrationStopReason;
};

export const rotateJob: JobHandlerFn = async (rawPayload, ctx): Promise<void> => {
  const payload = rawPayload as RotateJobPayload; // @cast-boundary engine-payload
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
  const db = ctx.db as DbConnection; // @cast-boundary db-operator
  const batchSize = payload.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxFailures = payload.maxFailures ?? DEFAULT_MAX_FAILURES;
  const deadline = payload.maxDurationMs
    ? Date.now() + payload.maxDurationMs
    : Number.POSITIVE_INFINITY;

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

  type SecretRow = {
    id: string;
    tenantId: string;
    version: number;
    envelope: StoredEnvelope;
    kekVersion: number;
  };

  // A partial batch means the ne-filter is exhausted — the next re-query
  // would only re-serve rows that failed above; end the run instead.
  let sawPartialBatch = false;
  async function nextBatch(): Promise<readonly SecretRow[]> {
    if (sawPartialBatch) return [];
    const batch = await selectMany<SecretRow>(
      db,
      tenantSecretsTable,
      { kekVersion: { ne: provider.currentVersion() } },
      { limit: batchSize },
    );
    if (batch.length < batchSize) sawPartialBatch = true;
    return batch;
  }

  async function migrateRow(row: SecretRow): Promise<"migrated" | "skipped" | "failed"> {
    const rotated = await rewrapDek(decodeStoredEnvelope(row.envelope), provider);
    if (rotated.kekVersion === row.kekVersion) return "skipped";

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
          envelope: encodeStoredEnvelope(rotated),
          kekVersion: rotated.kekVersion,
        },
      },
      actor,
      tdbFor(row.tenantId as TenantId),
    );

    // version_conflict == another writer (secrets.set or a parallel
    // rotation worker) beat us — the row is already in a valid state,
    // potentially even past target.
    if (!result.isSuccess) {
      if (result.error.code === "version_conflict") return "skipped";
      ctx.log?.warn?.(`[secrets:rotate] executor rejected row ${row.id}`, {
        code: result.error.code,
      });
      return "failed";
    }
    return "migrated";
  }

  const outcome = await runChunkedMigration<SecretRow>({
    nextBatch,
    migrateRow,
    maxFailures,
    deadlineAt: deadline,
    signal: ctx.signal,
    onRowError: (row, err) => {
      ctx.log?.warn?.(`[secrets:rotate] failed to rotate row ${row.id}`, { err });
    },
  });

  const result: RotateJobResult = {
    migrated: outcome.migrated,
    failed: outcome.failed,
    batchesProcessed: outcome.batchesProcessed,
    stoppedReason: outcome.stoppedReason,
  };
  ctx.log?.info?.(`[secrets:rotate] complete: ${JSON.stringify(result)}`);
};
