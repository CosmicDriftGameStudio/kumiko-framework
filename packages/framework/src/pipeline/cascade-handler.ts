import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import type { WriteResult } from "@cosmicdrift/kumiko-types/handlers";
import type { PreDeleteHookFn } from "@cosmicdrift/kumiko-types/hooks";
import type { EntityId } from "@cosmicdrift/kumiko-types/identifiers";
import type {
  HasManyRelation,
  ManyToManyRelation,
  RelationDefinition,
} from "@cosmicdrift/kumiko-types/relations";
import type { TableColumns } from "../db/dialect.ts";
import { createEventStoreExecutor, type EventStoreExecutor } from "../db/event-store-executor.ts";
import { type AnyDb, fetchOne, selectMany } from "../db/query.ts";
import type { TenantDb } from "../db/tenant-db.ts";
import { isBoundTenantDb } from "../db/tenant-db-runner.ts";
import type { OnDeleteStrategy } from "../engine/constants.ts";
import { OnDeleteStrategies, SystemHookNames, SystemHookPriorities } from "../engine/constants.ts";
import { isRecordLocked } from "../engine/screen-helpers.ts";
import { createSystemUser } from "../engine/system-user.ts";
import type { Registry, SessionUser } from "../engine/types/index.ts";
import { RecordLockedError } from "../errors/classes.ts";
import {
  ConflictError,
  FrameworkReasons,
  InternalError,
  reraiseAsKumikoError,
} from "../errors/index.ts";

import type { SystemHookDef } from "./lifecycle-pipeline.ts";

type TableMap = ReadonlyMap<string, TableColumns>;

// The cascade is a consequence of the parent delete the caller was already authorized for, so the
// children are written as the framework system user and the lock decision is taken once, up front.
const CASCADE_CHILD_WRITE_OPTIONS = { unsafeSkipLockGuard: true } as const;

type ChildRow = { readonly id: string };
type MappedTable = NonNullable<ReturnType<TableMap["get"]>>;

// Per-delete state: built inside each hook call so executors and the write db never outlive the
// parent delete's transaction.
type CascadeRun = {
  readonly registry: Registry;
  readonly db: AnyDb;
  readonly entityName: string;
  readonly parentId: EntityId;
  readonly lockGuardBypassed: boolean;
  readonly cascadeUser: SessionUser;
  readonly executorFor: (name: string, entity: EntityDefinition) => EventStoreExecutor;
  readonly writeDb: TenantDb | undefined;
};

type HasManyLink = {
  readonly target: string;
  readonly foreignKey: string;
  readonly table: MappedTable;
};

type ThroughLink = {
  readonly throughTable: string;
  readonly sourceKey: string;
  readonly table: MappedTable;
};

type OnDeleteHandlers<Link> = {
  readonly [Strategy in OnDeleteStrategy]: (run: CascadeRun, link: Link) => Promise<void>;
};

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
        ctx.obs.log?.debug(
          `cascadeDelete: skipping — ${!entityName ? "no entityName" : "no db"} on payload ${payload.id}`,
        );
        return;
      }

      const writeDb: TenantDb | undefined = isBoundTenantDb(db) ? db : undefined;
      const run: CascadeRun = {
        registry,
        db,
        entityName,
        parentId: payload.id,
        lockGuardBypassed: payload.lockGuardBypassed === true,
        cascadeUser: createSystemUser(writeDb?.tenantId ?? payload.event.tenantId),
        executorFor: createExecutorCache(tables),
        writeDb,
      };

      // Cascade applies to outgoing hasMany / manyToMany relations only —
      // the parent side of the link is where `onDelete` lives (see
      // relations.ts). Incoming belongsTo edges are covered because their
      // counterpart hasMany declares the strategy.
      // Outgoing: e.g. department.users (hasMany target: user) — users have FK to department
      for (const relation of Object.values(registry.getRelations(entityName))) {
        await applyOnDelete(run, tables, relation);
      }
    },
  };
}

function createExecutorCache(
  tables: TableMap,
): (name: string, entity: EntityDefinition) => EventStoreExecutor {
  const executors = new Map<string, EventStoreExecutor>();
  return (name, entity) => {
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
}

function requireCascadeWriteDb(writeDb: TenantDb | undefined): TenantDb {
  if (!writeDb) {
    throw new InternalError({
      message: "cascadeDelete: a TenantDb is required to write children",
    });
  }
  return writeDb;
}

function unwrap(result: WriteResult): void {
  if (!result.isSuccess) throw reraiseAsKumikoError(result.error);
}

async function childIds(
  run: CascadeRun,
  targetTable: MappedTable,
  where: Record<string, unknown>,
  entity: EntityDefinition,
): Promise<readonly string[]> {
  // A soft-deleted child is already invisible; deleting it again would fail.
  const rows = await selectMany<ChildRow>(
    run.db,
    targetTable,
    { ...where, ...(entity.softDelete === true && { isDeleted: false }) },
    { fields: ["id"] },
  );
  return rows.map((row) => row.id);
}

// Only hasMany / manyToMany carry cascade semantics. belongsTo points
// at a parent; the parent's onDelete decides what happens to this node.
async function applyOnDelete(
  run: CascadeRun,
  tables: TableMap,
  relation: RelationDefinition,
): Promise<void> {
  if (relation.type === "hasMany" && relation.foreignKey) {
    const table = tables.get(relation.target);
    if (table) {
      const link = { target: relation.target, foreignKey: relation.foreignKey, table };
      await HAS_MANY_ON_DELETE[onDeleteStrategyOf(relation)](run, link);
    }
  }
  if (relation.type === "manyToMany" && relation.through) {
    const table = tables.get(relation.through.table);
    if (table) {
      // sourceKey points at the owner side (the entity being deleted).
      const link = {
        throughTable: relation.through.table,
        sourceKey: relation.through.sourceKey,
        table,
      };
      await THROUGH_ON_DELETE[onDeleteStrategyOf(relation)](run, link);
    }
  }
}

function onDeleteStrategyOf(relation: HasManyRelation | ManyToManyRelation): OnDeleteStrategy {
  return relation.onDelete ?? OnDeleteStrategies.nothing;
}

async function leaveChildrenUnchanged(): Promise<void> {}

const HAS_MANY_ON_DELETE: OnDeleteHandlers<HasManyLink> = {
  nothing: leaveChildrenUnchanged,
  restrict: rejectReferencedParent,
  cascade: deleteHasManyChildren,
  setNull: detachHasManyChildren,
};

// A link row has no nullable side: setNull on a manyToMany leaves the through rows in place.
const THROUGH_ON_DELETE: OnDeleteHandlers<ThroughLink> = {
  nothing: leaveChildrenUnchanged,
  restrict: rejectReferencedThroughRows,
  cascade: deleteThroughRows,
  setNull: leaveChildrenUnchanged,
};

async function rejectReferencedParent(run: CascadeRun, link: HasManyLink): Promise<void> {
  const row = await fetchOne(run.db, link.table, { [link.foreignKey]: run.parentId });
  if (row) throw deleteRestrictedError(run, link.target);
}

async function rejectReferencedThroughRows(run: CascadeRun, link: ThroughLink): Promise<void> {
  const row = await fetchOne(run.db, link.table, { [link.sourceKey]: run.parentId });
  if (row) throw deleteRestrictedError(run, link.throughTable);
}

function deleteRestrictedError(run: CascadeRun, blockingEntity: string): ConflictError {
  return new ConflictError({
    message: `${blockingEntity} has records referencing ${run.entityName}#${run.parentId}`,
    i18nKey: "errors.deleteRestricted",
    details: {
      reason: FrameworkReasons.deleteRestricted,
      blockingEntity,
      entity: run.entityName,
      entityId: run.parentId,
    },
  });
}

// ponytail: one executor call per child inside the parent's transaction, batch when child counts need it
async function deleteHasManyChildren(run: CascadeRun, link: HasManyLink): Promise<void> {
  const childEntity = requireChildEntity(run, link);
  await rejectLockedChildren(run, link, childEntity);
  const executor = run.executorFor(link.target, childEntity);
  for (const id of await childIds(
    run,
    link.table,
    { [link.foreignKey]: run.parentId },
    childEntity,
  )) {
    unwrap(
      await executor.delete(
        { id },
        run.cascadeUser,
        requireCascadeWriteDb(run.writeDb),
        CASCADE_CHILD_WRITE_OPTIONS,
      ),
    );
  }
}

async function detachHasManyChildren(run: CascadeRun, link: HasManyLink): Promise<void> {
  const childEntity = requireChildEntity(run, link);
  await rejectLockedChildren(run, link, childEntity);
  const executor = run.executorFor(link.target, childEntity);
  const rows = await selectMany<ChildRow>(
    run.db,
    link.table,
    { [link.foreignKey]: run.parentId },
    { fields: ["id"] },
  );
  for (const row of rows) {
    unwrap(
      await executor.update(
        { id: row.id, changes: { [link.foreignKey]: null } },
        run.cascadeUser,
        requireCascadeWriteDb(run.writeDb),
        {
          ...CASCADE_CHILD_WRITE_OPTIONS,
          skipOptimisticLock: true,
          includeDeleted: true,
        },
      ),
    );
  }
}

function requireChildEntity(run: CascadeRun, link: HasManyLink): EntityDefinition {
  const childEntity = run.registry.getEntity(link.target);
  if (!childEntity) {
    throw new InternalError({
      message: `cascadeDelete: child "${link.target}" is not an entity; changing its rows needs an executor`,
    });
  }
  return childEntity;
}

// The child writes skip the executor's lock guard (decided here once), so a locked
// child must block the parent delete instead of changing with it. The error names
// the parent only: the caller may delete the parent without reading the child.
async function rejectLockedChildren(
  run: CascadeRun,
  link: HasManyLink,
  childEntity: EntityDefinition,
): Promise<void> {
  const childLock = childEntity.lockedWhen;
  // skip: an unlockable child or an already bypassed parent delete has nothing to block
  if (childLock === undefined || run.lockGuardBypassed) return;
  // A soft-deleted child is invisible to the caller and must not block.
  const children = await selectMany(run.db, link.table, {
    [link.foreignKey]: run.parentId,
    ...(childEntity.softDelete === true && { isDeleted: false }),
  });
  if (children.some((child) => isRecordLocked(childLock, child))) {
    throw new RecordLockedError({ entityName: run.entityName, entityId: run.parentId });
  }
}

async function deleteThroughRows(run: CascadeRun, link: ThroughLink): Promise<void> {
  const throughEntity = run.registry.getEntity(link.throughTable);
  if (!throughEntity) {
    throw new InternalError({
      message: `cascadeDelete: through table "${link.throughTable}" is not an entity; deleting its rows needs an executor`,
    });
  }
  const executor = run.executorFor(link.throughTable, throughEntity);
  for (const id of await childIds(
    run,
    link.table,
    { [link.sourceKey]: run.parentId },
    throughEntity,
  )) {
    unwrap(
      await executor.delete(
        { id },
        run.cascadeUser,
        requireCascadeWriteDb(run.writeDb),
        CASCADE_CHILD_WRITE_OPTIONS,
      ),
    );
  }
}
