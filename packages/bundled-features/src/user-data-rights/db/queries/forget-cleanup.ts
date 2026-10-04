import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { userTable } from "../../../user/index.js";

export async function selectUsersDueForForgetCleanup(
  db: DbConnection,
  status: string,
  gracePeriodEndCutoff: Temporal.Instant | string,
): Promise<readonly { id: string }[]> {
  const cutoff =
    typeof gracePeriodEndCutoff === "string"
      ? Temporal.Instant.from(gracePeriodEndCutoff)
      : gracePeriodEndCutoff;
  return selectMany<{ id: string }>(db, userTable, {
    status,
    gracePeriodEnd: { lte: cutoff },
  });
}
