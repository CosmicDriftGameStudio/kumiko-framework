import { fetchOne, insertOne, updateMany } from "../bun-db/query";
import type { ReferenceDataDef } from "../engine/types";
import { SYSTEM_TENANT_ID } from "../engine/types";
import type { DbConnection, DbRow } from "./connection";
import type { TableColumns } from "./dialect";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle dynamic tables
type Table = TableColumns<any>;

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
        await insertOne(db, table, {
          ...row,
          tenantId: SYSTEM_TENANT_ID,
          version: 1,
          insertedAt: Temporal.Now.instant(),
        });
        inserted++;
      }
    }
  }

  return { inserted, updated };
}
