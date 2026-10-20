import type { EntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
import { deleteMany, requireEntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
import type { AnyDb } from "@cosmicdrift/kumiko-framework/internal/stack-support";
import { withExecutorManagedWritesForTests } from "@cosmicdrift/kumiko-framework/internal/testing";

/** EntityTableMeta, a built table, or a plain table name string. */
export type ClearableTable = string | { readonly tableName?: string } | unknown;

// A full-table wipe (empty where) only needs the table name — give deleteMany
// a minimal-but-canonical EntityTableMeta so extractTableInfo accepts it
// without inferring columns.
function tableFromName(name: string): EntityTableMeta {
  return { tableName: name, columns: [], indexes: [], source: "unmanaged" };
}

function resolveClearableTable(table: ClearableTable): EntityTableMeta {
  if (typeof table === "string") return tableFromName(table);
  return requireEntityTableMeta(table, "clearTables");
}

/** Delete all rows from each table (order preserved — FK-sensitive callers order explicitly). */
export async function clearTables(db: AnyDb, tables: readonly ClearableTable[]): Promise<void> {
  for (const table of tables) {
    // Test teardown: clearing a managed projection between tests is not a production write.
    await deleteMany(withExecutorManagedWritesForTests(db), resolveClearableTable(table), {});
  }
}

/** Alias — same as clearTables, reads better in beforeEach. */
export async function resetTestTables(db: AnyDb, tables: readonly ClearableTable[]): Promise<void> {
  await clearTables(db, tables);
}
