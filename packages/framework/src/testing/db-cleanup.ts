/**
 * Integration-test DB cleanup — replaces copy-pasted `DELETE FROM …` in
 * beforeEach hooks. All table clears go through typed `deleteMany` (empty
 * where = full table wipe). Raw SQL stays out of test files.
 */
import type { EntityTableMeta } from "../db/entity-table-meta";
import { type AnyDb, deleteMany } from "../db/query";

/** EntityTableMeta, a built table, or a plain table name string. */
export type ClearableTable = string | { readonly tableName?: string } | unknown;

// A full-table wipe (empty where) only needs the table name — give deleteMany
// a minimal-but-canonical EntityTableMeta so extractTableInfo accepts it
// without inferring columns.
function tableFromName(name: string): EntityTableMeta {
  return { tableName: name, columns: [], indexes: [], source: "unmanaged" };
}

function resolveClearableTable(table: ClearableTable): unknown {
  if (typeof table === "string") return tableFromName(table);
  if (
    typeof table === "object" &&
    table !== null &&
    "tableName" in table &&
    typeof (table as { tableName?: unknown }).tableName === "string"
  ) {
    return table;
  }
  return table;
}

/** Delete all rows from each table (order preserved — FK-sensitive callers order explicitly). */
export async function clearTables(db: AnyDb, tables: readonly ClearableTable[]): Promise<void> {
  for (const table of tables) {
    // Test-teardown truncate: resolveClearableTable returns `unknown` (string
    // name or table object). The brand-strip cast is the sanctioned bypass —
    // clearing a managed projection between tests is not a production write.
    await deleteMany(db, resolveClearableTable(table) as EntityTableMeta, {});
  }
}

/** Alias — same as clearTables, reads better in beforeEach. */
export async function resetTestTables(db: AnyDb, tables: readonly ClearableTable[]): Promise<void> {
  await clearTables(db, tables);
}
