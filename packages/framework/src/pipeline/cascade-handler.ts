import { deleteMany, fetchOne, updateMany } from "../db/query";
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

      // Cascade applies to outgoing hasMany / manyToMany relations only —
      // the parent side of the link is where `onDelete` lives (see
      // relations.ts). Incoming belongsTo edges are covered because their
      // counterpart hasMany declares the strategy.
      const outgoing = registry.getRelations(entityName);

      // Outgoing: e.g. department.users (hasMany target: user) — users have FK to department
      for (const [, relation] of Object.entries(outgoing)) {
        // Only hasMany / manyToMany carry cascade semantics. belongsTo points
        // at a parent; the parent's onDelete decides what happens to this node.
        if (relation.type !== "hasMany" && relation.type !== "manyToMany") continue;
        const strategy = relation.onDelete ?? OnDeleteStrategies.nothing;
        if (strategy === OnDeleteStrategies.nothing) continue;

        if (relation.type === "hasMany" && relation.foreignKey) {
          const targetTable = tables.get(relation.target);
          if (!targetTable) continue;

          if (strategy === OnDeleteStrategies.restrict) {
            const row = await fetchOne(db, targetTable, { [relation.foreignKey]: payload.id });
            if (row) {
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
            await deleteMany(db, targetTable, { [relation.foreignKey]: payload.id });
          }

          if (strategy === OnDeleteStrategies.setNull) {
            await updateMany(
              db,
              targetTable,
              { [relation.foreignKey]: null },
              { [relation.foreignKey]: payload.id },
            );
          }
        }

        if (relation.type === "manyToMany" && relation.through) {
          const throughTable = tables.get(relation.through.table);
          if (!throughTable) continue;
          // sourceKey points at the owner side (the entity being deleted).
          const sourceKey = relation.through.sourceKey;

          if (strategy === OnDeleteStrategies.restrict) {
            const row = await fetchOne(db, throughTable, { [sourceKey]: payload.id });
            if (row) {
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
            await deleteMany(db, throughTable, { [sourceKey]: payload.id });
          }
        }
      }
    },
  };
}
