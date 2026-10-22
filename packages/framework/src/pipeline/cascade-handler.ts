import type { TableColumns } from "../db/dialect.ts";
import { createEventStoreExecutor, type EventStoreExecutor } from "../db/event-store-executor.ts";
import { fetchOne, selectMany } from "../db/query.ts";
import type { TenantDb } from "../db/tenant-db.ts";
import { isBoundTenantDb } from "../db/tenant-db-runner.ts";
import { OnDeleteStrategies, SystemHookNames, SystemHookPriorities } from "../engine/constants.ts";
import { isRecordLocked } from "../engine/screen-helpers.ts";
import { createSystemUser } from "../engine/system-user.ts";
import type {
  EntityDefinition,
  PreDeleteHookFn,
  Registry,
  WriteResult,
} from "../engine/types/index.ts";
import {
  ConflictError,
  FrameworkReasons,
  InternalError,
  RecordLockedError,
  reraiseAsKumikoError,
} from "../errors/index.ts";
import type { SystemHookDef } from "./lifecycle-pipeline.ts";

type TableMap = ReadonlyMap<string, TableColumns>;

// The cascade is a consequence of the parent delete the caller was already authorized for, so the
// children are written as the framework system user and the lock decision is taken once, up front.
const CASCADE_CHILD_WRITE_OPTIONS = { unsafeSkipLockGuard: true } as const;

type ChildRow = { readonly id: string };
type MappedTable = NonNullable<ReturnType<TableMap["get"]>>;

export function createCascadeDeleteHook(
  registry: Registry,
  tables: TableMap,
): SystemHookDef<PreDeleteHookFn> {
  return {
    name: SystemHookNames.cascadeDelete,
    priority: SystemHookPriorities.cascadeDelete,
    fn: async (payload, ctx) => {
      const entityName = payload.entityName;
      const db = ctx.systemDb
        ? ctx.systemDb.acknowledgeCrossTenant(
            `cascade delete for r.systemScope() write handler (${entityName ?? "unknown"})`,
          )
        : ctx.db;
      if (!entityName || !db) {
        ctx.log?.debug(
          `cascadeDelete: skipping — ${!entityName ? "no entityName" : "no db"} on payload ${payload.id}`,
        );
        return;
      }

      const writeDb: TenantDb | undefined = isBoundTenantDb(db) ? db : undefined;
      const cascadeUser = createSystemUser(writeDb?.tenantId ?? payload.event.tenantId);
      const executors = new Map<string, EventStoreExecutor>();
      const executorFor = (name: string, entity: EntityDefinition): EventStoreExecutor => {
        const cached = executors.get(name);
        if (cached) return cached;
        const table = tables.get(name);
        if (!table) {
          throw new InternalError({ message: `cascadeDelete: no table registered for "${name}"` });
        }
        const created = createEventStoreExecutor(table, entity, { entityName: name });
        executors.set(name, created);
        return created;
      };
      const requireWriteDb = (): TenantDb => {
        if (!writeDb) {
          throw new InternalError({
            message: "cascadeDelete: a TenantDb is required to write children",
          });
        }
        return writeDb;
      };
      const unwrap = (result: WriteResult): void => {
        if (!result.isSuccess) throw reraiseAsKumikoError(result.error);
      };
      const childIds = async (
        targetTable: MappedTable,
        where: Record<string, unknown>,
        entity: EntityDefinition | undefined,
      ): Promise<readonly string[]> => {
        // A soft-deleted child is already invisible; deleting it again would fail.
        const rows = await selectMany<ChildRow>(
          db,
          targetTable,
          { ...where, ...(entity?.softDelete === true && { isDeleted: false }) },
          { fields: ["id"] },
        );
        return rows.map((row) => row.id);
      };

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
          const childEntity = registry.getEntity(relation.target);
          if (
            !childEntity &&
            (strategy === OnDeleteStrategies.cascade || strategy === OnDeleteStrategies.setNull)
          ) {
            throw new InternalError({
              message: `cascadeDelete: child "${relation.target}" is not an entity; changing its rows needs an executor`,
            });
          }

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

          // The child writes below skip the executor's lock guard (decided here once), so a locked
          // child must block the parent delete instead of changing with it. The error names
          // the parent only: the caller may delete the parent without reading the child.
          if (strategy === OnDeleteStrategies.cascade || strategy === OnDeleteStrategies.setNull) {
            const childLock = childEntity?.lockedWhen;
            if (childLock !== undefined && payload.lockGuardBypassed !== true) {
              // A soft-deleted child is invisible to the caller and must not block.
              const children = await selectMany(db, targetTable, {
                [relation.foreignKey]: payload.id,
                ...(childEntity?.softDelete === true && { isDeleted: false }),
              });
              if (children.some((child) => isRecordLocked(childLock, child))) {
                throw new RecordLockedError({ entityName, entityId: payload.id });
              }
            }
          }

          // ponytail: one executor call per child inside the parent's transaction, batch when child counts need it
          if (strategy === OnDeleteStrategies.cascade && childEntity) {
            const executor = executorFor(relation.target, childEntity);
            for (const id of await childIds(
              targetTable,
              { [relation.foreignKey]: payload.id },
              childEntity,
            )) {
              unwrap(
                await executor.delete(
                  { id },
                  cascadeUser,
                  requireWriteDb(),
                  CASCADE_CHILD_WRITE_OPTIONS,
                ),
              );
            }
          }

          if (strategy === OnDeleteStrategies.setNull && childEntity) {
            const executor = executorFor(relation.target, childEntity);
            const rows = await selectMany<ChildRow>(
              db,
              targetTable,
              { [relation.foreignKey]: payload.id },
              { fields: ["id"] },
            );
            for (const row of rows) {
              unwrap(
                await executor.update(
                  { id: row.id, changes: { [relation.foreignKey]: null } },
                  cascadeUser,
                  requireWriteDb(),
                  {
                    ...CASCADE_CHILD_WRITE_OPTIONS,
                    skipOptimisticLock: true,
                    includeDeleted: true,
                  },
                ),
              );
            }
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
            const throughEntity = registry.getEntity(relation.through.table);
            if (!throughEntity) {
              throw new InternalError({
                message: `cascadeDelete: through table "${relation.through.table}" is not an entity; deleting its rows needs an executor`,
              });
            }
            const executor = executorFor(relation.through.table, throughEntity);
            for (const id of await childIds(
              throughTable,
              { [sourceKey]: payload.id },
              throughEntity,
            )) {
              unwrap(
                await executor.delete(
                  { id },
                  cascadeUser,
                  requireWriteDb(),
                  CASCADE_CHILD_WRITE_OPTIONS,
                ),
              );
            }
          }
        }
      }
    },
  };
}
