import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";

export async function deleteStaleSessionsBatch(
  db: DbConnection,
  olderThanDays: number,
  batchSize: number,
): Promise<number> {
  const rows = (await asRawClient(db).unsafe(
    `DELETE FROM "read_user_sessions"
     WHERE "id" IN (
       SELECT "id" FROM "read_user_sessions"
       WHERE "expires_at" < now() - ($1::int * interval '1 day')
          OR "revoked_at" < now() - ($1::int * interval '1 day')
       LIMIT $2
     )
     RETURNING "id"`,
    [olderThanDays, batchSize],
  )) as readonly { id: string }[];
  return rows.length;
}
