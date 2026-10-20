import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { unsafeReadRetrying } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { readStoredDraft } from "../../decrypt-draft.ts";
import type { FormDraftBlob } from "../../schemas.ts";

export type StaleDraftRow = {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly ownerId: string;
  readonly draftKey: string;
  readonly draft: FormDraftBlob | null;
  // Decryption failed (e.g. KMS outage): `draft: null` then does not mean "empty", so the row must
  // not be deleted — its FileRefs could not be released.
  readonly draftUnreadable?: true;
  readonly insertedAt: Temporal.Instant;
};

// COALESCE(modified_at, inserted_at) — a draft's "last touched" timestamp is
// modified_at once the upsert path (save.write.ts) has updated it at least
// once; a draft saved exactly once (create, never updated) has no
// modified_at yet, so falls back to inserted_at.
//
// Reads the blob + tenantId BEFORE anything is deleted (issue #1915) — the
// caller (cleanup.job.ts) walks each row's blob for FileRefs and releases
// them per-tenant via ctx._fileProviderResolver, then deletes the batch
// per-row via formDraftExecutor.delete (event-sourced, not raw SQL — a
// rebuild must not resurrect a "deleted" draft). Ordered oldest-first so a
// batch is a stable, deterministic slice across the two queries.
export async function selectStaleDraftsBatch(
  db: DbConnection,
  olderThanDays: number,
  batchSize: number,
  excludeIds: readonly string[] = [],
): Promise<readonly StaleDraftRow[]> {
  const rows = await unsafeReadRetrying<{
    id: string;
    tenant_id: string;
    owner_id: string;
    draft_key: string;
    draft: unknown;
    inserted_at: Date;
  }>(
    db,
    `SELECT "id", "tenant_id", "owner_id", "draft_key", "draft", "inserted_at" FROM "read_form_drafts"
     WHERE COALESCE("modified_at", "inserted_at") < now() - ($1::int * interval '1 day')
     AND NOT ("id"::text = ANY($3::text[]))
     ORDER BY COALESCE("modified_at", "inserted_at") ASC
     LIMIT $2`,
    [olderThanDays, batchSize, [...excludeIds]],
  );
  return Promise.all(
    rows.map(async (row) => {
      const base = {
        id: row.id,
        tenantId: row.tenant_id as TenantId, // @cast-boundary db-row
        ownerId: row.owner_id,
        draftKey: row.draft_key,
        insertedAt: Temporal.Instant.fromEpochMilliseconds(+row.inserted_at), // @cast-boundary db-row
      };
      try {
        return { ...base, draft: await readStoredDraft(row.draft) };
      } catch {
        return { ...base, draft: null, draftUnreadable: true as const };
      }
    }),
  );
}

/** Re-check staleness after the select→release window so a freshly saved draft is not deleted. */
export async function isDraftStillStale(
  db: DbConnection,
  tenantId: TenantId,
  id: string,
  olderThanDays: number,
): Promise<boolean> {
  const rows = await unsafeReadRetrying<unknown>(
    db,
    `SELECT 1 FROM "read_form_drafts"
     WHERE "id" = $1
       AND "tenant_id" = $2
       AND COALESCE("modified_at", "inserted_at") < now() - ($3::int * interval '1 day')
     LIMIT 1`,
    [id, tenantId, olderThanDays],
  );
  return rows.length > 0;
}
