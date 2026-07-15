// KEK-rotation job for userMfa.totpSecret (entity-field encryption, same
// MasterKeyProvider as secrets/config — see schema/user-mfa.ts). Modeled
// directly on config/handlers/reencrypt.job.ts: entity-field encryption
// stores a StoredEnvelope JSON string per value (no separate kekVersion
// column, unlike secrets' DEK-wrap model), so rotation means decrypt under
// the OLD key, then let the executor's own write-path re-encrypt under
// provider.currentVersion() — the same auto-encrypt every enable-confirm
// write already goes through (see enable-confirm.write.ts: it passes
// PLAINTEXT to executor.create, never a manually-built envelope).
//
// Idempotent: re-running skips rows already on the current kekVersion.
// Every write is a normal executor.update — after a full run even a
// from-scratch projection rebuild only ever sees the current-KEK envelope
// (the very risk this job's plan entry called out: a rebuild resurrecting
// an old-KEK wrap would happen if rotation only touched the read-side
// projection instead of appending a real `.updated` event).

import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configuredEntityFieldEncryption,
  createEventStoreExecutor,
  createTenantDb,
  type DbConnection,
  type TenantDb,
} from "@cosmicdrift/kumiko-framework/db";
import type { JobHandlerFn, SessionUser, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { type EnvelopeCipher, isStoredEnvelope } from "@cosmicdrift/kumiko-framework/secrets";
import { type ChunkedMigrationStopReason, runChunkedMigration } from "../../shared";
import { userMfaEntity, userMfaTable } from "../schema/user-mfa";

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_MAX_FAILURES = 10;
const SYSTEM_ROLES = ["system"] as const;

const executor = createEventStoreExecutor(userMfaTable, userMfaEntity, {
  entityName: "user-mfa",
});

export type MfaReencryptJobPayload = {
  readonly batchSize?: number;
  readonly maxDurationMs?: number;
  readonly maxFailures?: number;
};

export type MfaReencryptJobResult = {
  readonly migrated: number;
  readonly failed: number;
  readonly alreadyCurrent: number;
  readonly batchesProcessed: number;
  readonly stoppedReason: ChunkedMigrationStopReason;
};

function needsReencrypt(value: string, targetVersion: number): boolean {
  // legacy single-key format (base64 — can never start with "{")
  if (!value.startsWith("{")) return true;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isStoredEnvelope(parsed)) return true;
    return parsed.kekVersion !== targetVersion;
  } catch {
    // malformed JSON — let the decrypt attempt surface the real error
    return true;
  }
}

export const mfaReencryptJob: JobHandlerFn = async (rawPayload, ctx): Promise<void> => {
  const payload = rawPayload as MfaReencryptJobPayload; // @cast-boundary engine-payload
  const maybeCipher = configuredEntityFieldEncryption();
  if (!maybeCipher) {
    throw new InternalError({
      message:
        "[auth-mfa:reencrypt] entity-field encryption is not configured — provide a master key " +
        "(KUMIKO_SECRETS_MASTER_KEY_V<n>); run{Prod,Dev}App wire this automatically, custom boots " +
        "call configureEntityFieldEncryption(cipher).",
    });
  }
  // hoisted function declarations below capture this — pin the narrowed
  // type explicitly so TS keeps it inside the closures.
  const cipher: EnvelopeCipher = maybeCipher;
  if (!ctx.masterKeyProvider) {
    throw new InternalError({
      message:
        "[auth-mfa:reencrypt] ctx.masterKeyProvider missing — wire it via extraContext.masterKeyProvider at boot.",
    });
  }
  const provider = ctx.masterKeyProvider;
  if (!ctx.db) {
    throw new InternalError({
      message: "[auth-mfa:reencrypt] ctx.db missing — job context requires a database connection.",
    });
  }
  const db = ctx.db as DbConnection; // @cast-boundary db-operator

  const batchSize = payload.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxFailures = payload.maxFailures ?? DEFAULT_MAX_FAILURES;
  const deadline = payload.maxDurationMs
    ? Date.now() + payload.maxDurationMs
    : Number.POSITIVE_INFINITY;

  const tdbCache = new Map<TenantId, TenantDb>();
  function tdbFor(tenantId: TenantId): TenantDb {
    let existing = tdbCache.get(tenantId);
    if (!existing) {
      existing = createTenantDb(db, tenantId, "system");
      tdbCache.set(tenantId, existing);
    }
    return existing;
  }

  type UserMfaRow = {
    id: string;
    tenantId: string;
    version: number;
    totpSecret: string;
  };

  let alreadyCurrent = 0;
  const targetVersion = provider.currentVersion();

  // ponytail: one full candidate scan — MFA rows are user-scale, not
  // tenant-scale like config; cursor pagination when that ever matters.
  // Served in slices so runChunkedMigration's deadline/signal/failure
  // checks run between chunks, not only once.
  let pending: UserMfaRow[] | undefined;
  async function nextBatch(): Promise<readonly UserMfaRow[]> {
    if (pending === undefined) {
      pending = [...(await selectMany<UserMfaRow>(db, userMfaTable, {}))];
    }
    return pending.splice(0, batchSize);
  }

  async function migrateRow(row: UserMfaRow): Promise<"migrated" | "skipped" | "failed"> {
    if (!needsReencrypt(row.totpSecret, targetVersion)) {
      alreadyCurrent++;
      return "skipped";
    }

    const tenantId = row.tenantId as TenantId; // @cast-boundary db-row
    // decrypt failure (missing legacy key, unknown kekVersion, tamper)
    // throws → counted as failed via onRowError; the row stays untouched.
    const plaintext = await cipher.decrypt(row.totpSecret, { tenantId });

    const actor: SessionUser = { id: "system", tenantId, roles: SYSTEM_ROLES };
    // PLAINTEXT here, not a manually-built envelope — the executor's own
    // write-path (encryptForStorage) re-encrypts under the CURRENT
    // injected cipher/KEK, exactly like every other write to this field.
    const result = await executor.update(
      { id: row.id, version: row.version, changes: { totpSecret: plaintext } },
      actor,
      tdbFor(tenantId),
    );

    // version_conflict == a concurrent enable/disable/regenerate beat us;
    // the row now holds a fresh write, already fine.
    if (!result.isSuccess) {
      if (result.error.code === "version_conflict") return "skipped";
      ctx.log?.warn?.(`[auth-mfa:reencrypt] executor rejected row ${row.id}`, {
        code: result.error.code,
      });
      return "failed";
    }
    return "migrated";
  }

  const outcome = await runChunkedMigration<UserMfaRow>({
    nextBatch,
    migrateRow,
    maxFailures,
    deadlineAt: deadline,
    signal: ctx.signal,
    onRowError: (row, err) => {
      ctx.log?.warn?.(`[auth-mfa:reencrypt] failed to re-encrypt row ${row.id}`, { err });
    },
  });

  const result: MfaReencryptJobResult = {
    migrated: outcome.migrated,
    failed: outcome.failed,
    alreadyCurrent,
    batchesProcessed: outcome.batchesProcessed,
    stoppedReason: outcome.stoppedReason,
  };
  ctx.log?.info?.(`[auth-mfa:reencrypt] complete: ${JSON.stringify(result)}`);
};
