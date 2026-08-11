import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";

// Narrows a draft blob's raw FileRef-shaped storageKeys (collectDraftFileRefKeys
// output — extracted from free-form, client-supplied JSON, issue #1889) down to
// the ones with a real, non-deleted file_refs row owned by this exact
// (tenantId, ownerId). Without this, a crafted draft value like
// { storageKey: "<someone-else's-real-key>" } would reach the storage
// provider's delete() unchecked — the same ownership boundary file-routes.ts
// enforces (loadFileForTenant + FileAccessGuard) before every read/delete.
export async function filterOwnedStorageKeys(
  db: DbRunner,
  tenantId: TenantId,
  ownerId: string,
  candidateKeys: readonly string[],
): Promise<readonly string[]> {
  if (candidateKeys.length === 0) return [];
  const rows = (await asRawClient(db).unsafe(
    `SELECT "storage_key" FROM "file_refs"
     WHERE "tenant_id" = $1 AND "inserted_by_id" = $2
       AND "storage_key" = ANY($3::text[]) AND "is_deleted" = false`,
    [tenantId, ownerId, candidateKeys],
  )) as readonly { storage_key: string }[];
  return rows.map((row) => row.storage_key);
}
