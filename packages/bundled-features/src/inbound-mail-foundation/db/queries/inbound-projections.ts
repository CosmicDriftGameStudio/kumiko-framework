// Raw-SQL-Helper für die inline projections — Muster
// billing-foundation/db/queries/subscription-projection.ts.
//
// Warum raw statt drizzle-insert: die apply-fns laufen in der event-TX
// mit einem DbRunner, und die ON-CONFLICT-Semantik (UPSERT vs.
// DO NOTHING) ist der fachliche Kern — explizit hingeschrieben statt
// hinter einem ORM-Builder versteckt.

import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";

/** INSERT ... ON CONFLICT ("id") DO UPDATE SET <setClauses>. */
export async function upsertProjectionRow(
  tx: DbRunner,
  tableName: string,
  insertCols: Record<string, unknown>,
  setClauses: readonly string[],
  params: readonly unknown[],
): Promise<void> {
  const insertKeys = Object.keys(insertCols);
  const insertPlaceholders = insertKeys.map((_, i) => `$${i + 1}`);
  const sqlText = `INSERT INTO "${tableName}" (${insertKeys.map((k) => `"${k}"`).join(", ")}) VALUES (${insertPlaceholders.join(", ")}) ON CONFLICT ("id") DO UPDATE SET ${setClauses.join(", ")}`;
  await asRawClient(tx).unsafe(sqlText, params);
}

/** INSERT ... ON CONFLICT ("id") DO NOTHING — für append-only-Rows
 *  (inbound-message: genau EIN received-event pro Stream, Replays
 *  no-op'en auf der PK). */
export async function insertIgnoreProjectionRow(
  tx: DbRunner,
  tableName: string,
  insertCols: Record<string, unknown>,
): Promise<void> {
  const insertKeys = Object.keys(insertCols);
  const insertPlaceholders = insertKeys.map((_, i) => `$${i + 1}`);
  const sqlText = `INSERT INTO "${tableName}" (${insertKeys.map((k) => `"${k}"`).join(", ")}) VALUES (${insertPlaceholders.join(", ")}) ON CONFLICT ("id") DO NOTHING`;
  await asRawClient(tx).unsafe(sqlText, Object.values(insertCols));
}
