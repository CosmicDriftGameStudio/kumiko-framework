import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import type { Temporal } from "temporal-polyfill";

// Narrows a draft blob's raw FileRef-shaped storageKeys (collectDraftFileRefKeys
// output — extracted from free-form, client-supplied JSON, issue #1889) down to
// the ones with a real, non-deleted file_refs row owned by this exact
// (tenantId, ownerId). Without this, a crafted draft value like
// { storageKey: "<someone-else's-real-key>" } would reach the storage
// provider's delete() unchecked — the same ownership boundary file-routes.ts
// enforces (loadFileForTenant + FileAccessGuard) before every read/delete.
//
// `draftInsertedAt` additionally excludes FileRefs that existed BEFORE the
// draft row was created. In edit-mode the draft blob carries the full form
// values, including FileRef pointers the domain entity pre-filled — those
// storageKeys are owned by the caller (uploaded by them, on an earlier
// entity) but must survive a discard/cleanup sweep because the live entity
// still references them. Only uploads that happened during THIS draft's
// lifetime (inserted after the draft row) are release-eligible.
//
// `isCreateMode` bypasses that timestamp filter entirely: a create-mode
// draftKey (`${screenId}:new:${draftId}`) mints its draftId lazily on the
// first step-change, so a file uploaded on step 0 gets a file_refs row
// timestamped BEFORE the draft row exists. There is no pre-filled entity in
// create-mode — every FileRef the draft references is draft-owned — so the
// filter would otherwise permanently exclude that key from every future
// discard/cleanup, leaking it as an unreleasable storage object.
export async function filterOwnedStorageKeys(
  db: DbRunner,
  tenantId: TenantId,
  ownerId: string,
  candidateKeys: readonly string[],
  draftInsertedAt: Temporal.Instant,
  isCreateMode: boolean,
): Promise<readonly string[]> {
  const rows = await filterOwnedFileRefs(
    db,
    tenantId,
    ownerId,
    candidateKeys,
    draftInsertedAt,
    isCreateMode,
  );
  return rows.map((row) => row.storageKey);
}

// Same ownership boundary as filterOwnedStorageKeys, but also returns the
// file_refs row id — a hard-erasure call (executor.forget) addresses the
// row by id, not by storageKey.
export type OwnedFileRef = {
  readonly id: string;
  readonly storageKey: string;
};

export async function filterOwnedFileRefs(
  db: DbRunner,
  tenantId: TenantId,
  ownerId: string,
  candidateKeys: readonly string[],
  draftInsertedAt: Temporal.Instant,
  isCreateMode: boolean,
): Promise<readonly OwnedFileRef[]> {
  if (candidateKeys.length === 0) return [];
  const rows = (await asRawClient(db).unsafe(
    `SELECT "id", "storage_key" FROM "file_refs"
     WHERE "tenant_id" = $1 AND "inserted_by_id" = $2
       AND "storage_key" = ANY($3::text[]) AND "is_deleted" = false
       AND ($5::boolean OR "inserted_at" > $4::timestamptz)`,
    [tenantId, ownerId, candidateKeys, draftInsertedAt.toString(), isCreateMode],
  )) as readonly { id: string; storage_key: string }[];
  return rows.map((row) => ({ id: row.id, storageKey: row.storage_key }));
}
