import type { AnyDb } from "../query";
import { executeRawQuery } from "./raw-sql";
import { quoteTableIdent } from "./table-ops";

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
