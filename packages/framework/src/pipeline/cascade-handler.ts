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

      // Check outgoing relations (this entity's hasMany/manyToMany)
      // AND incoming relations (other entities' belongsTo pointing here)
      const outgoing = registry.getRelations(entityName);
      const _incoming = registry.getIncomingRelations(entityName);

      // Outgoing: e.g. department.users (hasMany target: user) — users have FK to department
      for (const [, relation] of Object.entries(outgoing)) {
        const strategy = relation.onDelete ?? "nothing";
        if (strategy === "nothing") continue;

        if (relation.type === "hasMany" && relation.foreignKey) {
          const targetTable = tables.get(relation.target);
          if (!targetTable) continue;

          if (strategy === "restrict") {
            const rows = await db
              .select({ id: targetTable["id"] })
              .from(targetTable)
              .where(eq(targetTable[relation.foreignKey], payload.id))
              .limit(1);
            if (rows.length > 0) {
              throw new Error(
                `delete_restricted: ${relation.target} has records referencing ${entityName}#${payload.id}`,
              );
            }
          }

          if (strategy === "cascade") {
            await db.delete(targetTable).where(eq(targetTable[relation.foreignKey], payload.id));
          }

          if (strategy === "setNull") {
            await db
              .update(targetTable)
              .set({ [relation.foreignKey]: null })
              .where(eq(targetTable[relation.foreignKey], payload.id));
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
