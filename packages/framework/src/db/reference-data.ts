import { eq, sql } from "drizzle-orm";
import type { TableColumns } from "./dialect";
import type { ReferenceDataDef } from "../engine/types";
import type { DbConnection } from "./connection";

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

    const upsertKey = def.upsertKey ?? Object.keys(def.data[0]!)[0]!;
    const snakeKey = toSnakeCase(upsertKey);

    for (const row of def.data) {
      const keyValue = row[upsertKey];
      if (keyValue === undefined) continue;

      // Check if row exists
      const [existing] = await db
        .select()
        .from(table)
        .where(eq(table[upsertKey] ?? table[snakeKey], keyValue))
        .limit(1);

      if (existing) {
        // Update if any field changed
        const existingData = existing as Record<string, unknown>;
        const changes: Record<string, unknown> = {};
        for (const [field, value] of Object.entries(row)) {
          if (field === upsertKey) continue;
          if (existingData[field] !== value) {
            changes[field] = value;
          }
        }
        if (Object.keys(changes).length > 0) {
          await db
            .update(table)
            .set(changes)
            .where(eq(table[upsertKey] ?? table[snakeKey], keyValue));
          updated++;
        }
      } else {
        await db.insert(table).values(row);
        inserted++;
      }
    }
  }

  return { inserted, updated };
}

function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}
