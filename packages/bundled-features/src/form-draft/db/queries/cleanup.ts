import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";

// COALESCE(modified_at, inserted_at) — a draft's "last touched" timestamp is
// modified_at once the upsert path (save.write.ts) has updated it at least
// once; a draft saved exactly once (create, never updated) has no
// modified_at yet, so falls back to inserted_at.
export async function deleteStaleDraftsBatch(
  db: DbConnection,
  olderThanDays: number,
  batchSize: number,
): Promise<number> {
  const rows = (await asRawClient(db).unsafe(
    `DELETE FROM "read_form_drafts"
     WHERE "id" IN (
       SELECT "id" FROM "read_form_drafts"
       WHERE COALESCE("modified_at", "inserted_at") < now() - ($1::int * interval '1 day')
       LIMIT $2
     )
     RETURNING "id"`,
    [olderThanDays, batchSize],
  )) as readonly { id: string }[];
  return rows.length;
}
