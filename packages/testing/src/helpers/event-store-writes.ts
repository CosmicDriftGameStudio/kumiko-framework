// Test-side writes on event-sourced tables that go through the event store, so
// the event log and the projection stay consistent. Unlike seed.ts these survive
// a projection rebuild and fire the same events a handler would.

import {
  createEventStoreExecutor,
  createTenantDb,
  type DbConnection,
  fetchOne,
  selectMany,
  type WhereObject,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { executorManagedEntitySourceOf } from "@cosmicdrift/kumiko-framework/internal/testing";

type ExecutorArgs = Parameters<typeof createEventStoreExecutor>;

export type EventStoreWriteTarget = {
  readonly table: ExecutorArgs[0];
  readonly entity: ExecutorArgs[1];
  readonly entityName: string;
};

export type EventStoreWriteScope = {
  /** Tenant of the acting system user and of the tenant-bound db; defaults to the system tenant. */
  readonly tenantId?: TenantId;
  /** Address a stream that lives on another tenant than the actor's. */
  readonly streamTenantId?: TenantId;
};

type EntityId = string | number;

function isEntityId(value: unknown): value is EntityId {
  return typeof value === "string" || typeof value === "number";
}

async function loadTarget(
  db: DbConnection,
  target: EventStoreWriteTarget,
  where: WhereObject,
  verb: string,
): Promise<{ id: EntityId; version: number }> {
  const row = await fetchOne<Record<string, unknown>>(db, target.table, where);
  if (!row) {
    throw new Error(`${verb} ${target.entityName}: no row matches ${JSON.stringify(where)}`);
  }
  const { id, version } = row;
  if (!isEntityId(id)) throw new Error(`${verb} ${target.entityName}: row has no id`);
  if (typeof version !== "number") {
    throw new Error(`${verb} ${target.entityName}: row has no numeric version`);
  }
  return { id, version };
}

function writeContext(scope: EventStoreWriteScope | undefined, db: DbConnection) {
  const tenantId = scope?.tenantId ?? SYSTEM_TENANT_ID;
  return {
    user: createSystemUser(tenantId),
    tenantDb: createTenantDb({ db, tenantId, mode: "system" }),
    options: scope?.streamTenantId ? { streamTenantId: scope.streamTenantId } : undefined,
  };
}

function failedWrite(
  verb: string,
  entityName: string,
  error: { readonly code: string; readonly details?: unknown },
): Error {
  return new Error(
    `${verb} ${entityName} failed: ${error.code} ${JSON.stringify(error.details ?? {})}`,
  );
}

// Same arguments as seedRow, so a seed on an entity table switches over by rename. The row's
// tenantId picks the acting tenant (and so the stream tenant); seed global entities without one,
// the executor rejects a tenantId on them.
export async function seedRowViaEventStore(
  db: DbConnection,
  table: EventStoreWriteTarget["table"],
  values: Readonly<Record<string, unknown>>,
): Promise<void> {
  const source = executorManagedEntitySourceOf(table);
  if (!source) {
    throw new Error(
      "seedRowViaEventStore: table is not an event-sourced entity table (buildEntityTable or r.entity); use seedRow",
    );
  }
  const { entity, entityName } = source;
  const { tenantId, ...payload } = values;
  if (payload["id"] !== undefined && typeof payload["id"] !== "string") {
    throw new Error(
      `seed ${entityName}: id must be a string, the event store would mint a new one`,
    );
  }
  if (tenantId !== undefined && typeof tenantId !== "string") {
    throw new Error(`seed ${entityName}: tenantId must be a string`);
  }
  const { user, tenantDb } = writeContext({ tenantId }, db);
  const executor = createEventStoreExecutor(table, entity, { entityName });
  const result = await executor.create(payload, user, tenantDb);
  if (!result.isSuccess) throw failedWrite("seed", entityName, result.error);
}

export async function updateRowViaEventStore(
  db: DbConnection,
  target: EventStoreWriteTarget,
  where: WhereObject,
  changes: Readonly<Record<string, unknown>>,
  scope?: EventStoreWriteScope,
): Promise<void> {
  const { id, version } = await loadTarget(db, target, where, "update");
  const { user, tenantDb, options } = writeContext(scope, db);
  const executor = createEventStoreExecutor(target.table, target.entity, {
    entityName: target.entityName,
  });
  const result = await executor.update(
    { id, version, changes: { ...changes } },
    user,
    tenantDb,
    options,
  );
  if (!result.isSuccess) throw failedWrite("update", target.entityName, result.error);
}

export async function deleteRowViaEventStore(
  db: DbConnection,
  target: EventStoreWriteTarget,
  where: WhereObject,
  scope?: EventStoreWriteScope,
): Promise<void> {
  const { id } = await loadTarget(db, target, where, "delete");
  const { user, tenantDb, options } = writeContext(scope, db);
  const executor = createEventStoreExecutor(target.table, target.entity, {
    entityName: target.entityName,
  });
  const result = await executor.delete({ id }, user, tenantDb, options);
  if (!result.isSuccess) throw failedWrite("delete", target.entityName, result.error);
}

/** Deletes every row matching `where`, each through its own event-store delete. */
export async function deleteRowsViaEventStore(
  db: DbConnection,
  target: EventStoreWriteTarget,
  where: WhereObject,
  scope?: EventStoreWriteScope,
): Promise<void> {
  const rows = await selectMany<{ id: EntityId }>(db, target.table, where);
  for (const { id } of rows) {
    await deleteRowViaEventStore(db, target, { id }, scope);
  }
}
