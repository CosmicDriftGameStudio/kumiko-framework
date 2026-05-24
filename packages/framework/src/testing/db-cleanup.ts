/**
 * Integration-test DB cleanup — replaces copy-pasted `DELETE FROM …` in
 * beforeEach hooks. All table clears go through typed `deleteMany` (empty
 * where = full table wipe). Raw SQL stays out of test files.
 */
import { deleteMany, type AnyDb } from "../db/query";

const KUMIKO_NAME_SYMBOL = Symbol.for("kumiko:schema:Name");
const KUMIKO_COLUMNS_SYMBOL = Symbol.for("kumiko:schema:Columns");

/** EntityTableMeta, drizzle pgTable, or plain table name string. */
export type ClearableTable = string | { readonly tableName?: string } | unknown;

function tableFromName(name: string): unknown {
  return {
    [KUMIKO_NAME_SYMBOL]: name,
    [KUMIKO_COLUMNS_SYMBOL]: {},
  };
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
export async function clearTables(
  db: AnyDb,
  tables: readonly ClearableTable[],
): Promise<void> {
  for (const table of tables) {
    await deleteMany(db, resolveClearableTable(table), {});
  }
}

/** Alias — same as clearTables, reads better in beforeEach. */
export async function resetTestTables(
  db: AnyDb,
  tables: readonly ClearableTable[],
): Promise<void> {
  await clearTables(db, tables);
}
