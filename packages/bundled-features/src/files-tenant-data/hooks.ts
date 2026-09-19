// EXT_TENANT_DATA + EXT_STORAGE_PROVIDER destroy hooks for the `fileRef`
// entity (#2474). Kept apart from the `files` feature (like folders-user-data
// does for EXT_USER_DATA) so file consumers without the tenant-lifecycle
// pipeline don't pull a hard dependency — `files` stays usable standalone.
//
// Two hooks cover two different destroy stages:
//   - fileRefTenantDestroyHook ("app-data" stage, EXT_TENANT_DATA): purges
//     every fileRef ROW for the tenant via forget() — rebuild-safe, mirrors
//     document-ingest-foundation's documentExtractTenantDestroyHook. No
//     isDeleted filter: tenant-destroy purges trashed rows too, a destroyed
//     tenant has no "restore from trash" future. ALSO sweeps, per row, any
//     storageKey that does NOT sit under one of this tenant's own
//     tenantStoragePrefixes() — the shape a tenant-handover (kumiko-
//     framework#3035) leaves behind: the fileRef row's tenantId moved to
//     this tenant, but the bytes stayed under the SOURCE tenant's prefix
//     (moving them would mean copying bytes, which the handover design
//     explicitly rejects). Must run here, not in the "files" stage below —
//     that stage's own prefix sweep only reaches keys under ITS tenant's
//     prefixes by construction, and by the time it runs this hook has
//     already forgotten (hard-deleted) the rows it would need to read the
//     storageKey off. Deleted by STEM prefix (storageKeyStemPrefix), not the
//     exact key: a derived variant (thumbnail, resized render) has no
//     `file_refs` row of its own, so only the stem reaches original +
//     derivatives together.
//   - fileRefStorageDestroyHook ("files" stage, EXT_STORAGE_PROVIDER): wipes
//     every BINARY (original + derivatives + anything else) under the
//     tenant's storage prefixes. A full prefix sweep per tenantStoragePrefixes()
//     entry, not a per-row derivative lookup — not every layout puts tenantId
//     first (see tenantExportPrefix), so this must sweep every known prefix,
//     stays correct even though the "files" stage runs after "app-data"
//     already forgot the rows, and can never cross into another tenant's keys
//     (the provider's own list() prefix already scopes it). Still catches a
//     blob with no fileRef row at all (the orphan case the row-driven sweep
//     above cannot see) — REFINED, not replaced, to skip a key a FOREIGN
//     tenant's fileRef row still references (a tenant-handover, kumiko-
//     framework#3035, leaves the row's tenantId moved but the storageKey
//     under THIS tenant's prefix unchanged). By the time this stage runs,
//     the "app-data" stage (stages.ts DESTRUCTION_STAGES: "app-data" before
//     "files") has already hard-deleted every row THIS tenant owned, so any
//     surviving row a listed key still matches is, by construction, a
//     foreign tenant's — no tenant comparison needed, existence is enough.
//     The exception is computed from the SURVIVING row's storageKeyStemPrefix
//     (mirroring the deletion side above), not the listed key's exact match:
//     a derivative has no fileRef row of its own, so excluding only exact
//     matches would still delete it out from under the tenant that claimed
//     its original. Batched: one existence query per chunk of listed keys,
//     not one query per key.

import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  type StorageProviderDestroyTenantHook,
  type StorageProviderHookCtx,
  type TenantDataDestroyHook,
  type TenantDataHookCtx,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  assertSafeStorageKey,
  fileRefEntity,
  fileRefsTable,
  storageKeyStemPrefix,
  tenantStoragePrefixes,
} from "@cosmicdrift/kumiko-framework/files";

const crud = createEventStoreExecutor(fileRefsTable, fileRefEntity, { entityName: "fileRef" });

// Existence-check batch size for fileRefStorageDestroyHook's survivor lookup
// — bounds each query instead of one `storage_key = ANY(...)` per listed key,
// or a single unbounded array for a tenant with a huge prefix.
const SURVIVOR_CHECK_BATCH_SIZE = 500;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function isUnderOwnPrefix(storageKey: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => storageKey.startsWith(prefix));
}

export const fileRefTenantDestroyHook: TenantDataDestroyHook = async (ctx) => {
  const rows = await ctx.db.selectMany<{ id: string; storageKey: string }>(fileRefsTable, {
    tenantId: ctx.tenantId,
  });
  const ownPrefixes = tenantStoragePrefixes(ctx.tenantId);
  const user = createSystemUser(ctx.tenantId);
  for (const row of rows) {
    if (!isUnderOwnPrefix(row.storageKey, ownPrefixes)) {
      await deleteHandedOverBinary(ctx, row.storageKey);
    }
    const result = await crud.forget({ id: row.id }, user, ctx.db);
    // Executor writes return {isSuccess:false} instead of throwing — a
    // discarded result would report this destroy stage "succeeded" while the
    // row (and its PII fileName) survives. Throw so the pipeline's
    // retry/abandon handling sees it.
    if (!result.isSuccess) {
      throw new Error(
        `files-tenant-data: failed to forget fileRef ${row.id} for tenant ${ctx.tenantId}: ${result.error.message}`,
      );
    }
  }
};

async function deleteHandedOverBinary(ctx: TenantDataHookCtx, storageKey: string): Promise<void> {
  if (!ctx.fileProviderResolver) {
    // skip: same graceful-degradation stance as fileRefStorageDestroyHook —
    // no provider wired means the binary sweep is skipped, not fail-closed.
    ctx.log?.(
      `[files-tenant-data] no fileProviderResolver wired — handed-over binary for ${storageKey} is NOT deleted`,
    );
    return;
  }
  let provider: Awaited<ReturnType<NonNullable<TenantDataHookCtx["fileProviderResolver"]>>>;
  try {
    provider = await ctx.fileProviderResolver(ctx.tenantId);
  } catch (err) {
    ctx.log?.(
      `[files-tenant-data] no file provider resolvable for tenant ${ctx.tenantId}: ${err instanceof Error ? err.message : String(err)} — handed-over binary for ${storageKey} NOT deleted`,
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
    // Resolution unavailable (no file-provider-* feature mounted, or the job
    // ctx didn't wire one) degrades to a no-op — same "not fail-closed"
    // stance as the per-user forget hook's resolveProvider: a misconfigured
    // store must not block the rest of the destroy pipeline forever. The row
    // purge from the "app-data" stage already ran regardless.
    ctx.log?.(
      `[files-tenant-data] no fileProviderResolver wired — tenant ${tenantId}'s file binaries are NOT deleted on destroy`,
    );
    // skip: no resolver wired for this destroy run — already logged above, and
    // the row purge from the "app-data" stage ran regardless.
    return;
  }
  let provider: Awaited<ReturnType<typeof ctx.fileProviderResolver>>;
  try {
    provider = await ctx.fileProviderResolver(tenantId);
  } catch (err) {
    ctx.log?.(
      `[files-tenant-data] no file provider resolvable for tenant ${tenantId}: ${err instanceof Error ? err.message : String(err)} — binaries NOT deleted`,
    );
    // skip: provider resolution failed for this tenant — already logged
    // above, binaries are left in place rather than blocking the pipeline.
    return;
  }
  // Provider resolved — a list()/delete() failure from here IS fail-closed:
  // the "files" stage throws, tenant-lifecycle's retry/abandon handling sees
  // it, and the next sweep tick retries (list+delete are idempotent, so this
  // converges rather than double-deleting or erroring on a missing key).
  for (const prefix of tenantStoragePrefixes(tenantId)) {
    const keys = await provider.list(prefix);
    const keptStemPrefixes = await survivorStemPrefixes(ctx.db, keys);
    for (const key of keys) {
      if (keptStemPrefixes.some((stemPrefix) => key.startsWith(stemPrefix))) continue;
      assertSafeStorageKey(key);
      await provider.delete(key);
    }
  }
};

// Any listed key that is itself a surviving row's exact storageKey means a
// foreign tenant still owns it (see header comment) — its stem prefix then
// also protects any derivative of that same original sitting in the same
// listed batch, none of which have their own fileRef row.
async function survivorStemPrefixes(
  db: StorageProviderHookCtx["db"],
  keys: readonly string[],
): Promise<readonly string[]> {
  const stemPrefixes: string[] = [];
  for (const batch of chunk(keys, SURVIVOR_CHECK_BATCH_SIZE)) {
    if (batch.length === 0) continue;
    const survivors = await selectMany<{ storageKey: string }>(db, fileRefsTable, {
      storageKey: batch,
    });
    for (const survivor of survivors) stemPrefixes.push(storageKeyStemPrefix(survivor.storageKey));
  }
  return stemPrefixes;
}
