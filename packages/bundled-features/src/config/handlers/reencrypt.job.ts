// Re-encrypt job for `encrypted: true` config values. Two jobs in one,
// because format detection makes them the same loop:
//   - MIGRATION: legacy CONFIG_ENCRYPTION_KEY values (base64 blob, no key
//     id) → envelope format under the current master key. After a clean
//     run the legacy key can be dropped from the environment.
//   - KEK-ROTATION: envelope values wrapped under an older kekVersion →
//     re-encrypted under provider.currentVersion(). Config has no
//     kek_version column (values live in a TEXT column), so unlike the
//     secrets rotate job the version check parses the stored JSON.
//
// Idempotent: a re-run skips rows already on the current version. Every
// write goes through the event-store executor (config values are
// entity-backed — raw UPDATEs would be wiped by a projection rebuild),
// so each migration appends a normal `.updated` event whose payload
// carries the NEW envelope: after a full run even a from-scratch rebuild
// no longer needs the legacy key for the final state.

import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  createEventStoreExecutor,
  createTenantDb,
  type DbConnection,
  type TenantDb,
} from "@cosmicdrift/kumiko-framework/db";
import type { JobHandlerFn, SessionUser, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { isStoredEnvelope } from "@cosmicdrift/kumiko-framework/secrets";
import { configValueEntity, configValuesTable } from "../table";

const DEFAULT_MAX_FAILURES = 10;
const SYSTEM_ROLES = ["system"] as const;

const executor = createEventStoreExecutor(configValuesTable, configValueEntity, {
  entityName: "config-value",
});

export type ReencryptJobPayload = {
  readonly maxDurationMs?: number;
  readonly maxFailures?: number;
};

export type ReencryptJobResult = {
  readonly migrated: number;
  readonly failed: number;
  readonly alreadyCurrent: number;
  readonly stoppedReason: "done" | "timeout" | "signal" | "too_many_failures";
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

export const reencryptJob: JobHandlerFn = async (rawPayload, ctx): Promise<void> => {
  const payload = rawPayload as ReencryptJobPayload; // @cast-boundary engine-payload
  const cipher = ctx.configEncryption;
  if (!cipher) {
    throw new InternalError({
      message:
        "[config:reencrypt] ctx.configEncryption missing — provide a master key " +
        "(KUMIKO_SECRETS_MASTER_KEY_V<n>) so the boot wires the envelope cipher.",
    });
  }
  const provider = ctx.masterKeyProvider;
  if (!provider) {
    throw new InternalError({
      message:
        "[config:reencrypt] ctx.masterKeyProvider missing — wire it via extraContext.masterKeyProvider at boot.",
    });
  }
  if (!ctx.db) {
    throw new InternalError({
      message: "[config:reencrypt] ctx.db missing — job context requires a database connection.",
    });
  }
  if (!ctx.registry) {
    throw new InternalError({
      message: "[config:reencrypt] ctx.registry missing — job context requires the registry.",
    });
  }
  const db = ctx.db as DbConnection; // @cast-boundary db-operator

  const encryptedKeys = [...ctx.registry.getAllConfigKeys()]
    .filter(([, def]) => def.encrypted === true)
    .map(([key]) => key);

  const maxFailures = payload.maxFailures ?? DEFAULT_MAX_FAILURES;
  const deadline = payload.maxDurationMs
    ? Date.now() + payload.maxDurationMs
    : Number.POSITIVE_INFINITY;

  let migrated = 0;
  let failed = 0;
  let alreadyCurrent = 0;
  let stoppedReason: ReencryptJobResult["stoppedReason"] = "done";

  const tdbCache = new Map<TenantId, TenantDb>();
  function tdbFor(tenantId: TenantId): TenantDb {
    let existing = tdbCache.get(tenantId);
    if (!existing) {
      existing = createTenantDb(db, tenantId, "system");
      tdbCache.set(tenantId, existing);
    }
    return existing;
  }

  if (encryptedKeys.length > 0) {
    const targetVersion = provider.currentVersion();
    // ponytail: one full candidate scan — config rows are operator-scale
    // (tenants × encrypted keys), cursor pagination when that ever changes.
    const rows = await selectMany<{
      id: string;
      key: string;
      value: string | null;
      tenantId: string;
      version: number;
    }>(db, configValuesTable, { key: { in: encryptedKeys } });

    for (const row of rows) {
      if (ctx.signal?.aborted) {
        stoppedReason = "signal";
        break;
      }
      if (Date.now() >= deadline) {
        stoppedReason = "timeout";
        break;
      }
      if (failed >= maxFailures) {
        stoppedReason = "too_many_failures";
        break;
      }
      if (row.value === null || row.value === undefined) continue;
      if (!needsReencrypt(row.value, targetVersion)) {
        alreadyCurrent++;
        continue;
      }

      try {
        const tenantId = row.tenantId as TenantId; // @cast-boundary db-row
        const plaintext = await cipher.decrypt(row.value, { tenantId });
        const reencrypted = await cipher.encrypt(plaintext, { tenantId });

        const actor: SessionUser = { id: "system", tenantId, roles: SYSTEM_ROLES };
        const result = await executor.update(
          { id: row.id, version: row.version, changes: { value: reencrypted } },
          actor,
          tdbFor(tenantId),
        );

        // version_conflict == a concurrent config:set beat us; the row now
        // holds a fresh envelope written by the set handler — already fine.
        if (!result.isSuccess) {
          if (result.error.code === "version_conflict") continue;
          failed++;
          ctx.log?.warn?.(`[config:reencrypt] executor rejected row ${row.id}`, {
            code: result.error.code,
          });
          continue;
        }
      } catch (err) {
        // decrypt failure (missing legacy key, unknown kekVersion, tamper)
        // leaves the row untouched — never write anything we couldn't read.
        failed++;
        ctx.log?.warn?.(`[config:reencrypt] failed to re-encrypt row ${row.id}`, { err });
        continue;
      }
      migrated++;
    }
  }

  const result: ReencryptJobResult = { migrated, failed, alreadyCurrent, stoppedReason };
  ctx.log?.info?.(`[config:reencrypt] complete: ${JSON.stringify(result)}`);
};
