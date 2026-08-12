import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { Temporal } from "temporal-polyfill";
import type { FormDraftBlob } from "../../schemas";

export type StaleDraftRow = {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly ownerId: string;
  readonly draft: FormDraftBlob;
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
): Promise<readonly StaleDraftRow[]> {
  const rows = (await asRawClient(db).unsafe(
    `SELECT "id", "tenant_id", "owner_id", "draft", "inserted_at" FROM "read_form_drafts"
     WHERE COALESCE("modified_at", "inserted_at") < now() - ($1::int * interval '1 day')
     ORDER BY COALESCE("modified_at", "inserted_at") ASC
     LIMIT $2`,
    [olderThanDays, batchSize],
  )) as readonly {
    id: string;
    tenant_id: string;
    owner_id: string;
    draft: FormDraftBlob;
    inserted_at: Date;
  }[];
  return rows.map((row) => ({
    id: row.id,
    tenantId: row.tenant_id as TenantId, // @cast-boundary db-row
    ownerId: row.owner_id,
    draft: row.draft,
    insertedAt: Temporal.Instant.fromEpochMilliseconds(row.inserted_at.getTime()), // @cast-boundary db-row
  }));
}
