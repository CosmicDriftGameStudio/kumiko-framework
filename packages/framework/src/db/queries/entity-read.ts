import type { AnyDb } from "../query.ts";
import { quoteIdent } from "../sql-identifier.ts";
import { executeRawQuery } from "./raw-sql.ts";

export async function selectRowForUpdateById(
  db: AnyDb,
  tableName: string,
  id: string | number,
): Promise<readonly Record<string, unknown>[]> {
  return executeRawQuery(db, `SELECT * FROM ${quoteIdent(tableName)} WHERE "id" = $1 FOR UPDATE`, [
    id,
  ]);
}
