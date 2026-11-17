import type {
  EventStoreExecutor,
  ExecutorCreateOptions,
  ExecutorSaveContext,
  ExecutorUpdateOptions,
} from "@cosmicdrift/kumiko-types/event-store-executor-types";
import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import type { EntityId } from "@cosmicdrift/kumiko-types/identifiers";
import type { TenantDb } from "@cosmicdrift/kumiko-types/tenant-db-types";
import type { SessionUser, TenantId } from "../engine/types/index.ts";
import { InternalError, type WriteFailure, writeFailure } from "../errors/index.ts";
import { VersionConflictError } from "../event-store/errors.ts";
import { appendMany } from "../event-store/append-many.ts";
import type { EventToAppend } from "../event-store/event-store.ts";
import type { StoredEvent } from "../event-store/index.ts";
import { applyCreatedEntityEvents, applyEntityEvent } from "./apply-entity-event.ts";
import type { DbRow } from "./connection.ts";
import type { TableColumns } from "./dialect.ts";
import { tryMapUniqueViolation } from "./event-store-executor-context.ts";
import { runInSavepointIfSupported } from "./query.ts";
import { withExecutorManagedWrites } from "./tenant-db.ts";
import { tenantDbWriteRunnerForTable } from "./tenant-db-runner.ts";

type WriteRunner = ReturnType<typeof tenantDbWriteRunnerForTable>;

export type PreparedCreate = {
  readonly aggregateId: string;
  readonly streamTenantId: TenantId | undefined;
  readonly streamTenant: TenantId;
  readonly data: DbRow;
  readonly flatCreateData: DbRow;
  readonly claimedFileRefIds: readonly string[];
  readonly toAppend: EventToAppend;
};

export type PreparedUpdate = {
  readonly id: EntityId;
  readonly previous: DbRow;
  readonly changes: DbRow;
  readonly changedPrevious: DbRow;
  readonly flatChangesPlain: DbRow;
  readonly streamTenant: TenantId;
  readonly currentVersion: number;
  readonly claimedFileRefIds: readonly string[];
  readonly toAppend: EventToAppend;
};

type ConflictContext = {
  readonly entityId: EntityId;
  readonly expectedVersion: number;
  readonly streamTenant: TenantId;
};

type BatchDeps = {
  readonly table: TableColumns;
  readonly entity: EntityDefinition;
  readonly entityName: string;
  readonly prepareCreate: (
    payload: Record<string, unknown>,
    user: SessionUser,
    db: TenantDb,
    options: ExecutorCreateOptions | undefined,
  ) => Promise<WriteFailure | PreparedCreate>;
  readonly prepareUpdate: (
    payload: { id: EntityId; version?: number | undefined; changes: Record<string, unknown> },
    user: SessionUser,
    db: TenantDb,
    options: ExecutorUpdateOptions | undefined,
  ) => Promise<WriteFailure | PreparedUpdate>;
  readonly finishCreate: (
    db: TenantDb,
    runner: WriteRunner,
    prepared: PreparedCreate,
    event: StoredEvent,
    row: DbRow,
  ) => Promise<ExecutorSaveContext>;
  readonly finishUpdate: (
    db: TenantDb,
    runner: WriteRunner,
    prepared: PreparedUpdate,
    event: StoredEvent,
    row: DbRow,
  ) => Promise<ExecutorSaveContext>;
  readonly appendConflictFailure: (
    error: unknown,
    runner: WriteRunner,
    conflict: ConflictContext,
  ) => Promise<WriteFailure>;
};

function eventAndRowAt(
  events: readonly StoredEvent[],
  rows: readonly DbRow[],
  index: number,
): readonly [StoredEvent, DbRow] {
  const event = events[index];
  const row = rows[index];
  if (event === undefined || row === undefined) {
    throw new InternalError({ message: `batch write: no event or row at position ${index}` });
  }
  return [event, row];
}

export function createBatchWriteVerbs(
  deps: BatchDeps,
): Pick<EventStoreExecutor, "createMany" | "updateMany"> {
  const { table, entity, entityName } = deps;

  // Attributes a failed batch to the stream that lost; the whole batch is rolled back either way.
  async function batchFailure(
    error: unknown,
    runner: WriteRunner,
    conflicts: readonly ConflictContext[],
  ): Promise<WriteFailure> {
    const mapped = tryMapUniqueViolation(error, entityName);
    if (mapped) return mapped;
    const failedAggregateId = error instanceof VersionConflictError ? error.aggregateId : undefined;
    const conflict =
      conflicts.find((candidate) => String(candidate.entityId) === failedAggregateId) ??
      conflicts[0];
    if (conflict === undefined) throw error;
    return deps.appendConflictFailure(error, runner, conflict);
  }

  return {
    async createMany(payloads, user, db, options) {
      if (payloads.length === 0) return { isSuccess: true, data: [] };
      const runner = tenantDbWriteRunnerForTable(db, "ctx.db executor createMany", table);
      const prepared: PreparedCreate[] = [];
      for (const payload of payloads) {
        const item = await deps.prepareCreate(payload, user, db, options);
        if ("isSuccess" in item) return item;
        prepared.push(item);
      }

      let committed: { events: readonly StoredEvent[]; rows: readonly DbRow[] };
      try {
        committed = await runInSavepointIfSupported(withExecutorManagedWrites(runner), async (sp) => {
          const events = await appendMany(
            sp,
            prepared.map((item) => item.toAppend),
          );
          const rows = await applyCreatedEntityEvents(events, table, entity, sp);
          return { events, rows };
        });
      } catch (e) {
        return await batchFailure(
          e,
          runner,
          prepared.map((item) => ({
            entityId: item.aggregateId,
            expectedVersion: 0,
            streamTenant: item.streamTenant,
          })),
        );
      }

      const saved: ExecutorSaveContext[] = [];
      for (const [index, item] of prepared.entries()) {
        const [event, row] = eventAndRowAt(committed.events, committed.rows, index);
        saved.push(await deps.finishCreate(db, runner, item, event, row));
      }
      return { isSuccess: true, data: saved };
    },

    async updateMany(items, user, db, options) {
      if (items.length === 0) return { isSuccess: true, data: [] };
      const ids = new Set<string>();
      for (const item of items) {
        if (ids.has(String(item.id))) {
          return writeFailure(
            new InternalError({ message: `${entityName}.updateMany: duplicate id ${item.id}` }),
          );
        }
        ids.add(String(item.id));
      }
      const runner = tenantDbWriteRunnerForTable(db, "ctx.db executor updateMany", table);
      const prepared: PreparedUpdate[] = [];
      for (const item of items) {
        const result = await deps.prepareUpdate(item, user, db, options);
        if ("isSuccess" in result) return result;
        prepared.push(result);
      }

      let events: readonly StoredEvent[];
      let rows: DbRow[];
      try {
        const committed = await runInSavepointIfSupported(
          withExecutorManagedWrites(runner),
          async (sp) => {
            const appended = await appendMany(
              sp,
              prepared.map((item) => item.toAppend),
            );
            // One UPDATE per row because every row sets different columns; the append is the
            // shared statement.
            const applied: DbRow[] = [];
            for (const event of appended) {
              const result = await applyEntityEvent(event, table, entity, sp);
              if (result.kind !== "applied" || result.row === null) {
                throw new InternalError({
                  message: `${entityName}.updateMany: projection update returned no row`,
                });
              }
              applied.push(result.row);
            }
            return { appended, applied };
          },
        );
        events = committed.appended;
        rows = committed.applied;
      } catch (e) {
        return await batchFailure(
          e,
          runner,
          prepared.map((item) => ({
            entityId: item.id,
            expectedVersion: item.currentVersion,
            streamTenant: item.streamTenant,
          })),
        );
      }

      const saved: ExecutorSaveContext[] = [];
      for (const [index, item] of prepared.entries()) {
        const [event, row] = eventAndRowAt(events, rows, index);
        saved.push(await deps.finishUpdate(db, runner, item, event, row));
      }
      return { isSuccess: true, data: saved };
    },
  };
}
