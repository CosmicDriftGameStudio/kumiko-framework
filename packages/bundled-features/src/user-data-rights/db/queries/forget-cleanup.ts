import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";

export async function selectUsersDueForForgetCleanup(
  db: DbConnection,
  status: string,
  gracePeriodEnd: string,
): Promise<readonly { id: string }[]> {
  return asRawClient(db).unsafe<{ id: string }>(
    `SELECT id FROM read_users WHERE status = $1 AND grace_period_end <= $2`,
    [status, gracePeriodEnd],
  );
}
