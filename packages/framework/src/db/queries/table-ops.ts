import type { AnyDb } from "../query.ts";
import { asRawClient } from "../query.ts";
import { quoteIdent } from "../sql-identifier.ts";

export async function truncateTable(db: AnyDb, tableName: string): Promise<void> {
  await asRawClient(db).unsafe(`TRUNCATE TABLE ${quoteIdent(tableName)}`);
}
