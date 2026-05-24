import { fetchOne, insertOne, updateMany } from "../db/query";
import type { ReferenceDataDef } from "../engine/types";
import { SYSTEM_TENANT_ID } from "../engine/types";
import type { DbConnection, DbRow } from "./connection";
import type { TableColumns } from "./dialect";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle dynamic tables
type Table = TableColumns<any>;

const KUMIKO_COLUMNS_SYMBOL = Symbol.for("kumiko:schema:Columns");

function hasColumn(table: Table, field: string): boolean {
  const cols = (table as Record<symbol, unknown>)[KUMIKO_COLUMNS_SYMBOL];
  if (typeof cols !== "object" || cols === null) return false;
  return field in (cols as Record<string, unknown>);
}

/**
 * Seed reference data at boot time.
 * For each ReferenceDataDef: upsert rows (insert missing, update changed, never delete).
 * Upsert key defaults to the first field in the data object.
 */
export async function seedReferenceData(
  defs: readonly ReferenceDataDef[],
  tables: ReadonlyMap<string, Table>,
  db: DbConnection,
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;

  for (const def of defs) {
    const table = tables.get(def.entityName);
    if (!table) continue;
    if (def.data.length === 0) continue;

    const firstRow = def.data[0];
    if (!firstRow) continue;
    const firstKey = Object.keys(firstRow)[0];
    if (!firstKey) continue;
    const upsertKey = def.upsertKey ?? firstKey;

    for (const row of def.data) {
      const keyValue = row[upsertKey];
      if (keyValue === undefined) continue;

      const existing = (await fetchOne(db, table, { [upsertKey]: keyValue })) as DbRow | undefined;

      if (existing) {
        const changes: Record<string, unknown> = {};
        for (const [field, value] of Object.entries(row)) {
          if (field === upsertKey) continue;
          if (existing[field] !== value) {
            changes[field] = value;
          }
        }
        if (Object.keys(changes).length > 0) {
          await updateMany(db, table, changes, { [upsertKey]: keyValue });
          updated++;
        }
      } else {
        // Only add framework columns if the table actually has them.
        // Drizzle used to filter extra fields silently; bunInsertOne doesn't.
        const values: Record<string, unknown> = { ...row };
        if (hasColumn(table, "tenantId")) values["tenantId"] = SYSTEM_TENANT_ID;
        if (hasColumn(table, "version")) values["version"] = 1;
        if (hasColumn(table, "insertedAt")) values["insertedAt"] = Temporal.Now.instant();
        await insertOne(db, table, values);
        inserted++;
      }
    }
  }

  return { inserted, updated };
}
