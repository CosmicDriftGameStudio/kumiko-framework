import { eq, sql } from "drizzle-orm";
import type { PgTableWithColumns } from "drizzle-orm/pg-core";
import type { DbConnection } from "../db/connection";
import type { PreDeleteHookFn, Registry } from "../engine/types";
import type { SystemHookDef } from "./lifecycle-pipeline";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle dynamic tables
type TableMap = ReadonlyMap<string, PgTableWithColumns<any>>;

export function createCascadeDeleteHook(
  registry: Registry,
  tables: TableMap,
): SystemHookDef<PreDeleteHookFn> {
  return {
    name: "system:cascade-delete",
    priority: 500,
    fn: async (payload, _context) => {
      const entityName = (_context as Record<string, unknown>)["_entityName"] as string | undefined;
      const db = (_context as Record<string, unknown>)["db"] as DbConnection | undefined;
      if (!entityName || !db) return;

      const incoming = registry.getIncomingRelations(entityName);

      for (const { sourceEntity, relation } of incoming) {
        const strategy = relation.onDelete ?? "nothing";
        if (strategy === "nothing") continue;

        if (relation.type === "hasMany" && relation.foreignKey) {
          const sourceTable = tables.get(sourceEntity);
          if (!sourceTable) continue;

          if (strategy === "restrict") {
            const rows = await db
              .select({ id: sourceTable["id"] })
              .from(sourceTable)
              .where(eq(sourceTable[relation.foreignKey], payload.id))
              .limit(1);
            if (rows.length > 0) {
              throw new Error(
                `delete_restricted: ${sourceEntity} has records referencing ${entityName}#${payload.id}`,
              );
            }
          }

          if (strategy === "cascade") {
            await db.delete(sourceTable).where(eq(sourceTable[relation.foreignKey], payload.id));
          }

          if (strategy === "setNull") {
            await db
              .update(sourceTable)
              .set({ [relation.foreignKey]: null })
              .where(eq(sourceTable[relation.foreignKey], payload.id));
          }
        }

        if (relation.type === "manyToMany" && relation.through) {
          const throughTableName = relation.through.table;
          const targetKey = relation.through.targetKey;

          if (strategy === "restrict") {
            const result = await db.execute(
              sql`SELECT 1 FROM ${sql.identifier(throughTableName)} WHERE ${sql.identifier(targetKey)} = ${payload.id} LIMIT 1`,
            );
            const rows = result as unknown as unknown[];
            if (rows.length > 0) {
              throw new Error(
                `delete_restricted: ${throughTableName} has records referencing ${entityName}#${payload.id}`,
              );
            }
          }

          if (strategy === "cascade") {
            await db.execute(
              sql`DELETE FROM ${sql.identifier(throughTableName)} WHERE ${sql.identifier(targetKey)} = ${payload.id}`,
            );
          }
        }
      }
    },
  };
}
