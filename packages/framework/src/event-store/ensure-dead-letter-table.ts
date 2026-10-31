import type { DbConnection } from "../db/connection.ts";
import { tableExists } from "../db/schema-inspection.ts";
import { ensureTableRowLevelSecurity, unsafePushTables } from "../db/table-push.ts";

export async function ensureDeadLetterTable(
  db: DbConnection,
  qualifiedName: string,
  pushKey: string,
  table: unknown,
): Promise<void> {
  // skip: table already exists — bootstrap called from multiple paths
  if (await tableExists(db, qualifiedName)) {
    await ensureTableRowLevelSecurity(db, table);
    return;
  }
  await unsafePushTables(db, { [pushKey]: table });
}
