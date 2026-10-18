import type { AnyDb } from "../query.ts";
import { executeRawQuery } from "./raw-sql.ts";
import { quoteTableIdent } from "./table-ops.ts";

export async function selectRowForUpdateById(
  db: AnyDb,
  tableName: string,
  id: string | number,
): Promise<readonly Record<string, unknown>[]> {
  return executeRawQuery(
    db,
    `SELECT * FROM ${quoteTableIdent(tableName)} WHERE "id" = $1 FOR UPDATE`,
    [id],
  );
}
