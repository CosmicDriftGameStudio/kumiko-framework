// EXT_TENANT_DATA + EXT_STORAGE_PROVIDER destroy hooks for `fileRef`: two hooks, two stages
// ("app-data" runs before "files", see stages.ts DESTRUCTION_STAGES).
// - fileRefTenantDestroyHook forgets every row (no isDeleted filter) and deletes bytes outside the
//   tenant's own prefixes (tenant handover) by stem, since derivatives have no row of their own.
// - fileRefStorageDestroyHook wipes every tenantStoragePrefixes() prefix; keys a foreign tenant's
//   row still references stay, with their derivatives (by stem).
// Without a provider both are a logged no-op; once a provider resolves, list/delete errors fail closed.

import { createEventStoreExecutor, selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  parseTenantId,
  type StorageProviderDestroyTenantHook,
  type StorageProviderHookCtx,
  type TenantDataDestroyHook,
  type TenantDataHookCtx,
  type TenantDestroyHookResult,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  assertSafeStorageKey,
  fileRefEntity,
  fileRefsTable,
  NO_BACKUP_STORAGE_PREFIX,
  storageKeyStemPrefix,
  tenantStoragePrefixes,
} from "@cosmicdrift/kumiko-framework/files";
import { chunk } from "@cosmicdrift/kumiko-framework/utils";
import { type ChunkedMigrationResult, runChunkedMigration } from "../shared/index.ts";

const crud = createEventStoreExecutor(fileRefsTable, fileRefEntity, { entityName: "fileRef" });

// Bounds each survivor existence query per chunk of listed keys.
const SURVIVOR_CHECK_BATCH_SIZE = 500;

const DESTROY_CHUNK_SIZE = 500;

function isUnderOwnPrefix(storageKey: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => storageKey.startsWith(prefix));
}

function toDestroyHookResult(
  result: ChunkedMigrationResult,
  failureMessage: () => string | undefined,
): TenantDestroyHookResult {
  // A failure on the last item ends the run as "done" (nothing left to batch),
  // so the failed count, not the stop reason, decides fail-closed.
  if (result.failed > 0) {
    throw new Error(failureMessage() ?? "files-tenant-data: destroy chunk failed");
  }
  return { done: result.stoppedReason === "done", processed: result.migrated };
}

export const fileRefTenantDestroyHook: TenantDataDestroyHook = async (ctx) => {
  const ownPrefixes = tenantStoragePrefixes(ctx.tenantId);
  const user = createSystemUser(ctx.tenantId);
  let firstFailure: string | undefined;
  // Converges without a cursor: forget() hard-deletes, so each batch query
  // returns the next rows.
  const result = await runChunkedMigration<{ id: string; storageKey: string }>({
    nextBatch: () =>
      ctx.db.selectMany<{ id: string; storageKey: string }>(
        fileRefsTable,
        {
          tenantId: ctx.tenantId,
          id: { notIn: [...(ctx.heldFileRefIds ?? [])] },
        },
        { limit: DESTROY_CHUNK_SIZE },
      ),
    migrateRow: async (row) => {
      if (!isUnderOwnPrefix(row.storageKey, ownPrefixes)) {
        await deleteHandedOverBinary(ctx, row.storageKey);
      }
      const forgotten = await crud.forget({ id: row.id }, user, ctx.db);
      // Executor writes return {isSuccess:false} instead of throwing — a
      // discarded result would report this destroy stage "succeeded" while the
      // row (and its PII fileName) survives. Throw so the pipeline's
      // retry/abandon handling sees it.
      if (!forgotten.isSuccess) {
        throw new Error(
          `files-tenant-data: failed to forget fileRef ${row.id} for tenant ${ctx.tenantId}: ${forgotten.error.message}`,
        );
      }
      return "migrated";
    },
    maxFailures: 1,
    deadlineAt: ctx.deadlineAt ?? Number.POSITIVE_INFINITY,
    minBatches: 1,
    onRowError: (_row, err) => {
      firstFailure = err instanceof Error ? err.message : String(err);
    },
  });
  return toDestroyHookResult(result, () => firstFailure);
};

// The bytes live under the tenant that uploaded them (`<tenantId>/…` or
// `exports/<tenantId>/…`, `nobackup/<tenantId>/…`), so with per-tenant storage config that tenant's
// provider — not the destroyed destination tenant's — holds them.
const NO_BACKUP_SEGMENT = NO_BACKUP_STORAGE_PREFIX.slice(0, -1);

function storageKeyOwnerTenant(storageKey: string, fallback: TenantId): TenantId {
  const [first, second] = storageKey.split("/");
  return (
    parseTenantId(first) ??
    (first === "exports" || first === NO_BACKUP_SEGMENT ? parseTenantId(second) : null) ??
    fallback
  );
}

async function deleteHandedOverBinary(ctx: TenantDataHookCtx, storageKey: string): Promise<void> {
  if (!ctx.fileProviderResolver) {
    ctx.log?.(
      `[files-tenant-data] no fileProviderResolver wired — handed-over binary for ${storageKey} is NOT deleted`,
    );
    return;
  }
  const ownerTenantId = storageKeyOwnerTenant(storageKey, ctx.tenantId);
  let provider: Awaited<ReturnType<NonNullable<TenantDataHookCtx["fileProviderResolver"]>>>;
  try {
    provider = await ctx.fileProviderResolver(ownerTenantId);
  } catch (err) {
    ctx.log?.(
      `[files-tenant-data] no file provider resolvable for tenant ${ownerTenantId}: ${err instanceof Error ? err.message : String(err)} — handed-over binary for ${storageKey} NOT deleted`,
    );
    return;
  }
  for (const key of await provider.list(storageKeyStemPrefix(storageKey))) {
    assertSafeStorageKey(key);
    await provider.delete(key);
  }
}

export const fileRefStorageDestroyHook: StorageProviderDestroyTenantHook = async (
  tenantId,
  ctx,
) => {
  if (!ctx.fileProviderResolver) {
    // No resolver (no file-provider-* mounted) degrades to a no-op so a misconfigured store does not block the destroy pipeline.
    ctx.log?.(
      `[files-tenant-data] no fileProviderResolver wired — tenant ${tenantId}'s file binaries are NOT deleted on destroy`,
    );
    return;
  }
  let provider: Awaited<ReturnType<typeof ctx.fileProviderResolver>>;
  try {
    provider = await ctx.fileProviderResolver(tenantId);
  } catch (err) {
    ctx.log?.(
      `[files-tenant-data] no file provider resolvable for tenant ${tenantId}: ${err instanceof Error ? err.message : String(err)} — binaries NOT deleted`,
    );
    return;
  }
  // Past this point list()/delete() failures are fail-closed: tenant-lifecycle retries (idempotent) up to the attempt cap.
  let processed = 0;
  for (const prefix of tenantStoragePrefixes(tenantId)) {
    const keys = await provider.list(prefix);
    const keptStemPrefixes = await survivorStemPrefixes(ctx.db, keys);
    const deletableKeys = keys.filter((key) => !isUnderKeptStem(key, keptStemPrefixes));
    const pending = [...deletableKeys];
    let firstFailure: string | undefined;
    const result = await runChunkedMigration<string>({
      nextBatch: async () => pending.splice(0, DESTROY_CHUNK_SIZE),
      migrateRow: async (key) => {
        assertSafeStorageKey(key);
        await provider.delete(key);
        return "migrated";
      },
      maxFailures: 1,
      deadlineAt: ctx.deadlineAt ?? Number.POSITIVE_INFINITY,
      // list() and the survivor lookup above can use up the whole budget; one chunk per tick
      // still deletes, so the stage never reports "no progress".
      minBatches: 1,
      onRowError: (_key, err) => {
        firstFailure = err instanceof Error ? err.message : String(err);
      },
    });
    const hookResult = toDestroyHookResult(result, () => firstFailure);
    processed += result.migrated;
    if (!hookResult.done) return { done: false, processed };
  }
  return { done: true, processed };
};

// A surviving row's stem also protects its derivatives, which have no row of their own.
async function survivorStemPrefixes(
  db: StorageProviderHookCtx["db"],
  keys: readonly string[],
): Promise<ReadonlySet<string>> {
  const stemPrefixes = new Set<string>();
  for (const batch of chunk(keys, SURVIVOR_CHECK_BATCH_SIZE)) {
    if (batch.length === 0) continue;
    const survivors = await selectMany<{ storageKey: string }>(db, fileRefsTable, {
      storageKey: batch,
    });
    for (const survivor of survivors) stemPrefixes.add(storageKeyStemPrefix(survivor.storageKey));
  }
  return stemPrefixes;
}

// Stem prefixes always end at a '.', so a key starts with one exactly when one of its own '.'-terminated prefixes is in the set.
function isUnderKeptStem(key: string, keptStemPrefixes: ReadonlySet<string>): boolean {
  if (keptStemPrefixes.size === 0) return false;
  for (
    let dotIndex = key.indexOf(".");
    dotIndex !== -1;
    dotIndex = key.indexOf(".", dotIndex + 1)
  ) {
    if (keptStemPrefixes.has(key.slice(0, dotIndex + 1))) return true;
  }
  return false;
}
