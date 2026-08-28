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
//     tenant has no "restore from trash" future.
//   - fileRefStorageDestroyHook ("files" stage, EXT_STORAGE_PROVIDER): wipes
//     every BINARY (original + derivatives + anything else) under the
//     tenant's storage prefix. A full `${tenantId}/` prefix sweep, not a
//     per-row derivative lookup — buildStorageKey always puts tenantId first,
//     so this needs only the tenantId, stays correct even though the "files"
//     stage runs after "app-data" already forgot the rows, and can never
//     cross into another tenant's keys (the provider's own list() prefix
//     already scopes it).

import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventStoreExecutor, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  type StorageProviderDestroyTenantHook,
  type TenantDataDestroyHook,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  assertSafeStorageKey,
  fileRefEntity,
  fileRefsTable,
} from "@cosmicdrift/kumiko-framework/files";

const crud = createEventStoreExecutor(fileRefsTable, fileRefEntity, { entityName: "fileRef" });

export const fileRefTenantDestroyHook: TenantDataDestroyHook = async (ctx) => {
  const rows = await selectMany<{ id: string }>(ctx.db, fileRefsTable, {
    tenantId: ctx.tenantId,
  });
  const user = createSystemUser(ctx.tenantId);
  const db = createTenantDb(ctx.db, ctx.tenantId, "system");
  for (const row of rows) {
    const result = await crud.forget({ id: row.id }, user, db);
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
  // Provider resolved — a list()/delete() failure from here IS fail-closed:
  // the "files" stage throws, tenant-lifecycle's retry/abandon handling sees
  // it, and the next sweep tick retries (list+delete are idempotent, so this
  // converges rather than double-deleting or erroring on a missing key).
  const keys = await provider.list(`${tenantId}/`);
  for (const key of keys) {
    assertSafeStorageKey(key);
    await provider.delete(key);
  }
};
