// KEK-rotation job for `encrypted: true` config values: envelope values
// wrapped under an older kekVersion get re-encrypted under
// provider.currentVersion(). Config has no kek_version column (values live
// in a TEXT column), so unlike the secrets rotate job the version check
// parses the stored JSON.
//
// A row whose value isn't a current-cipher envelope (malformed JSON, or
// any pre-envelope format) is counted `failed` before any decrypt attempt
// and left untouched — migrateRow short-circuits on `unrecognized` instead
// of relying on cipher.decrypt to reject it. No legacy single-key path.
//
// Idempotent: a re-run skips rows already on the current version. Every
// write goes through the event-store executor (config values are
// entity-backed — raw UPDATEs would be wiped by a projection rebuild),
// so each rotation appends a normal `.updated` event whose payload carries
// the NEW envelope: after a full run even a from-scratch rebuild only
// ever sees the current-KEK envelope.
//
// systemScope() fail-closed pattern (framework#2056): the initial scan is
// intentionally cross-tenant (system-wide key rotation), acknowledged via
// UncheckedSystemDb.acknowledgeCrossTenant(). Rows are bucketed by tenant,
// and assertRowsTenant() re-verifies each row against its bucket's tenant
// right before the write — both checks are built locally from the exported
// createUncheckedSystemDb().

import {
  createEventStoreExecutor,
  createTenantDb,
  createUncheckedSystemDb,
  type DbConnection,
  type TenantDb,
  type UncheckedSystemDb,
} from "@cosmicdrift/kumiko-framework/db";
import {
  type JobHandlerFn,
  type SessionUser,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import type { EnvelopeCipher } from "@cosmicdrift/kumiko-framework/secrets";
import {
  type ChunkedMigrationStopReason,
  classifyStoredEnvelope,
  runChunkedMigration,
} from "../../shared";
import { configValueEntity, configValuesTable } from "../table";

const DEFAULT_MAX_FAILURES = 10;
const SCAN_SLICE_SIZE = 100;
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
  readonly stoppedReason: ChunkedMigrationStopReason;
};

export const reencryptJob: JobHandlerFn = async (rawPayload, ctx): Promise<void> => {
  const payload = rawPayload as ReencryptJobPayload; // @cast-boundary engine-payload
  const maybeCipher = ctx.configEncryption;
  if (!maybeCipher) {
    throw new InternalError({
      message:
        "[config:reencrypt] ctx.configEncryption missing — provide a master key " +
        "(KUMIKO_SECRETS_MASTER_KEY_V<n>) so the boot wires the envelope cipher.",
    });
  }
  // hoisted function declarations below capture these — pin the narrowed
  // type explicitly so TS keeps it inside the closures
  const cipher: EnvelopeCipher = maybeCipher;
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

  const tdbCache = new Map<TenantId, TenantDb>();
  function tdbFor(tenantId: TenantId): TenantDb {
    let existing = tdbCache.get(tenantId);
    if (!existing) {
      existing = createTenantDb(db, tenantId, "system");
      tdbCache.set(tenantId, existing);
    }
    return existing;
  }

  const sdbCache = new Map<TenantId, UncheckedSystemDb>();
  function sdbFor(tenantId: TenantId): UncheckedSystemDb {
    let existing = sdbCache.get(tenantId);
    if (!existing) {
      existing = createUncheckedSystemDb(tdbFor(tenantId));
      sdbCache.set(tenantId, existing);
    }
    return existing;
  }

  // Standalone from sdbCache/tdbCache on purpose: this one is only ever used
  // to acknowledge the cross-tenant scan below, never bound to a real
  // tenant's writes — sharing it with sdbFor(SYSTEM_TENANT_ID) would make a
  // write-path cache entry double as the scan's ack gate.
  const scanDb = createUncheckedSystemDb(createTenantDb(db, SYSTEM_TENANT_ID, "system"));

  type ConfigRow = {
    id: string;
    key: string;
    value: string | null;
    tenantId: string;
    version: number;
  };

  let alreadyCurrent = 0;
  const targetVersion = provider.currentVersion();

  type BucketedRow = { tenantId: TenantId; row: ConfigRow };

  // ponytail: one full candidate scan — config rows are operator-scale
  // (tenants × encrypted keys), cursor pagination when that ever changes.
  // Bucketed by tenant so each row keeps its bucket's tenant attached
  // (assertRowsTenant below re-checks that against the row's own field
  // right before the write) and the shared loop's deadline/signal/failure
  // checks still run between chunks, not only once.
  let buckets: Map<TenantId, ConfigRow[]> | undefined;
  async function loadBuckets(): Promise<Map<TenantId, ConfigRow[]>> {
    if (buckets) return buckets;
    const grouped = new Map<TenantId, ConfigRow[]>();
    if (encryptedKeys.length > 0) {
      const scanned = await scanDb
        .acknowledgeCrossTenant("system-wide key rotation")
        .selectMany<ConfigRow>(configValuesTable, { key: { in: encryptedKeys } });
      for (const row of scanned) {
        const tenantId = row.tenantId as TenantId; // @cast-boundary db-row
        const bucket = grouped.get(tenantId);
        if (bucket) bucket.push(row);
        else grouped.set(tenantId, [row]);
      }
    }
    buckets = grouped;
    return buckets;
  }

  async function nextBatch(): Promise<readonly BucketedRow[]> {
    const grouped = await loadBuckets();
    for (const [tenantId, rows] of grouped) {
      if (rows.length === 0) {
        grouped.delete(tenantId);
        continue;
      }
      const slice = rows.splice(0, SCAN_SLICE_SIZE);
      if (rows.length === 0) grouped.delete(tenantId);
      return slice.map((row) => ({ tenantId, row }));
    }
    return [];
  }

  async function migrateRow({
    tenantId,
    row,
  }: BucketedRow): Promise<"migrated" | "skipped" | "failed"> {
    if (row.value === null || row.value === undefined) return "skipped";
    const classification = classifyStoredEnvelope(row.value, targetVersion);
    if (classification === "current") {
      alreadyCurrent++;
      return "skipped";
    }

    if (classification === "unrecognized") {
      // Not a current-cipher envelope (malformed JSON, or any pre-envelope
      // format) — never a supported re-encrypt input, so fail loudly
      // instead of relying on cipher.decrypt to reject it. Log only the
      // row id, never the value (ciphertext-adjacent).
      ctx.log?.warn?.(
        `[config:reencrypt] row ${row.id} is not a current-cipher envelope, not re-encryptable`,
      );
      return "failed";
    }

    // Re-verify the row's own tenantId against the bucket it was scanned
    // into, right before the write (framework#2072) — a mismatch here
    // fails this row only (via onRowError below), it does not abort the
    // whole job.
    sdbFor(tenantId).assertRowsTenant([row], "tenantId");

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
      if (result.error.code === "version_conflict") return "skipped";
      ctx.log?.warn?.(`[config:reencrypt] executor rejected row ${row.id}`, {
        code: result.error.code,
      });
      return "failed";
    }
    return "migrated";
  }

  const outcome = await runChunkedMigration<BucketedRow>({
    nextBatch,
    migrateRow,
    maxFailures,
    deadlineAt: deadline,
    signal: ctx.signal,
    onRowError: ({ row }, err) => {
      ctx.log?.warn?.(`[config:reencrypt] failed to re-encrypt row ${row.id}`, { err });
    },
  });

  const result: ReencryptJobResult = {
    migrated: outcome.migrated,
    failed: outcome.failed,
    alreadyCurrent,
    stoppedReason: outcome.stoppedReason,
  };
  ctx.log?.info?.(`[config:reencrypt] complete: ${JSON.stringify(result)}`);
};
