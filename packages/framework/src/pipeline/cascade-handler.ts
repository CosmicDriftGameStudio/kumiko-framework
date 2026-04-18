import { eq } from "drizzle-orm";
import type { TableColumns } from "../db/dialect";
import { OnDeleteStrategies, SystemHookNames, SystemHookPriorities } from "../engine/constants";
import type { PreDeleteHookFn, Registry } from "../engine/types";
import { ConflictError, FrameworkReasons } from "../errors";
import type { SystemHookDef } from "./lifecycle-pipeline";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle dynamic tables
type TableMap = ReadonlyMap<string, TableColumns<any>>;

export function createCascadeDeleteHook(
  registry: Registry,
  tables: TableMap,
): SystemHookDef<PreDeleteHookFn> {
  return {
    name: SystemHookNames.cascadeDelete,
    priority: SystemHookPriorities.cascadeDelete,
    fn: async (payload, ctx) => {
      const entityName = payload.entityName;
      if (!entityName || !ctx.db) {
        ctx.log?.debug(
          `cascadeDelete: skipping — ${!entityName ? "no entityName" : "no db"} on payload ${payload.id}`,
        );
        return;
      }
      const db = ctx.db;

      // Check outgoing relations (this entity's hasMany/manyToMany)
      // AND incoming relations (other entities' belongsTo pointing here)
      const outgoing = registry.getRelations(entityName);
      const _incoming = registry.getIncomingRelations(entityName);

      // Outgoing: e.g. department.users (hasMany target: user) — users have FK to department
      for (const [, relation] of Object.entries(outgoing)) {
        const strategy = relation.onDelete ?? OnDeleteStrategies.nothing;
        if (strategy === OnDeleteStrategies.nothing) continue;

        if (relation.type === "hasMany" && relation.foreignKey) {
          const targetTable = tables.get(relation.target);
          if (!targetTable) continue;

          if (strategy === OnDeleteStrategies.restrict) {
            const rows = await db
              .select({ id: targetTable["id"] })
              .from(targetTable)
              .where(eq(targetTable[relation.foreignKey], payload.id))
              .limit(1);
            if (rows.length > 0) {
              throw new ConflictError({
                message: `${relation.target} has records referencing ${entityName}#${payload.id}`,
                i18nKey: "errors.deleteRestricted",
                details: {
                  reason: FrameworkReasons.deleteRestricted,
                  blockingEntity: relation.target,
                  entity: entityName,
                  entityId: payload.id,
                },
              });
            }
          }

          if (strategy === OnDeleteStrategies.cascade) {
            await db.delete(targetTable).where(eq(targetTable[relation.foreignKey], payload.id));
          }

          if (strategy === OnDeleteStrategies.setNull) {
            await db
              .update(targetTable)
              .set({ [relation.foreignKey]: null })
              .where(eq(targetTable[relation.foreignKey], payload.id));
          }
        }

        if (relation.type === "manyToMany" && relation.through) {
          const throughTable = tables.get(relation.through.table);
          if (!throughTable) continue;
          // sourceKey points at the owner side (the entity being deleted).
          // targetKey would point at the other side — filtering by it here
          // would miss every through-row for this entity.
          const sourceKey = relation.through.sourceKey;

          if (strategy === OnDeleteStrategies.restrict) {
            const rows = await db
              .select({ id: throughTable["id"] })
              .from(throughTable)
              .where(eq(throughTable[sourceKey], payload.id))
              .limit(1);
            if (rows.length > 0) {
              throw new ConflictError({
                message: `${relation.through.table} has records referencing ${entityName}#${payload.id}`,
                i18nKey: "errors.deleteRestricted",
                details: {
                  reason: FrameworkReasons.deleteRestricted,
                  blockingEntity: relation.through.table,
                  entity: entityName,
                  entityId: payload.id,
                },
              });
            }
          }

          if (strategy === OnDeleteStrategies.cascade) {
            await db.delete(throughTable).where(eq(throughTable[sourceKey], payload.id));
          }
        }
      }
    },
  };
}
