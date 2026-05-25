import type { AnyDb } from "../query";
import { asRawClient } from "../query";

/** Double-quote + escape — Postgres identifier rules. */
export function quoteTableIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export async function truncateTable(db: AnyDb, tableName: string): Promise<void> {
  await asRawClient(db).unsafe(`TRUNCATE TABLE ${quoteTableIdent(tableName)}`);
}
