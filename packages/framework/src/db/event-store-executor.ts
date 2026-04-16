import { and, asc, desc, eq, gt, inArray, type SQL } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import type {
  DeleteContext,
  EntityDefinition,
  EntityId,
  Registry,
  SaveContext,
  SessionUser,
  WriteResult,
} from "../engine/types";
import {
  VersionConflictError as FrameworkVersionConflict,
  InternalError,
  NotFoundError,
  UnprocessableError,
  writeFailure,
} from "../errors";
import {
  append,
  VersionConflictError as EventStoreVersionConflict,
  type StoredEvent,
} from "../event-store";
import type { EntityCache } from "../pipeline/entity-cache";
import type { SearchAdapter } from "../search/types";
import { decodeCursor, encodeCursor } from "./cursor";
import type { TableColumns } from "./dialect";
import type { CursorResult } from "./index";
import type { TenantDb } from "./tenant-db";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle dynamic tables
type Table = TableColumns<any>;

export type EventStoreExecutorOptions = {
  searchAdapter?: SearchAdapter;
  entityName: string; // required — the aggregateType marker on every event
  entityCache?: EntityCache;
};

// Per-call options shared across create/update/delete/restore.
// `registry` opts the caller into the projection runtime: after the event is
// appended and the auto-projection (entity table) is written, the executor
// iterates `registry.getProjectionsForSource(entityName)` and invokes
// `apply[event.type]` inside the same TX. Without a registry, projections
// never fire — tests and low-level integration calls that don't care about
// custom projections can omit it.
type RuntimeOptions = { registry?: Registry };

// Same shape as CrudExecutor so callers can be migrated without changing
// writeHandler bodies. The difference lives below the interface: create/update/
// delete append to the event-store and update the projection in the same TX,
// instead of writing the row directly.
export type EventStoreExecutor = {
  create: (
    payload: Record<string, unknown>,
    user: SessionUser,
    db: TenantDb,
    options?: RuntimeOptions,
  ) => Promise<WriteResult<SaveContext>>;

  update: (
    payload: { id: EntityId; version?: number | undefined; changes: Record<string, unknown> },
    user: SessionUser,
    db: TenantDb,
    options?: { skipOptimisticLock?: boolean } & RuntimeOptions,
  ) => Promise<WriteResult<SaveContext>>;

  delete: (
    payload: { id: EntityId },
    user: SessionUser,
    db: TenantDb,
    options?: RuntimeOptions,
  ) => Promise<WriteResult<DeleteContext>>;

  restore: (
    payload: { id: EntityId },
    user: SessionUser,
    db: TenantDb,
    options?: RuntimeOptions,
  ) => Promise<WriteResult<SaveContext>>;

  list: (
    payload: {
      cursor?: string | undefined;
      limit?: number | undefined;
      search?: string | undefined;
      sort?: string | undefined;
      sortDirection?: "asc" | "desc" | undefined;
    },
    user: SessionUser,
    db: TenantDb,
  ) => Promise<CursorResult<Record<string, unknown>>>;

  detail: (
    payload: { id: EntityId },
    user: SessionUser,
    db: TenantDb,
  ) => Promise<Record<string, unknown> | null>;
};

export function createEventStoreExecutor(
  table: Table,
  entity: EntityDefinition,
  options: EventStoreExecutorOptions,
): EventStoreExecutor {
  const { searchAdapter, entityName, entityCache } = options;
  const softDelete = entity.softDelete ?? false;

  if (entity.idType !== "uuid") {
    throw new Error(
      `event-store-executor requires entity "${entityName}" to declare idType: "uuid" — aggregate IDs must be UUIDs`,
    );
  }

  // Pre-compute defaults once so create() doesn't loop the entity every call.
  const fieldDefaults: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(entity.fields)) {
    if (
      (field.type === "text" ||
        field.type === "number" ||
        field.type === "boolean" ||
        field.type === "select") &&
      field.default !== undefined
    ) {
      fieldDefaults[name] = field.default;
    }
  }

  function applyDefaults(payload: Record<string, unknown>): Record<string, unknown> {
    if (Object.keys(fieldDefaults).length === 0) return payload;
    const result: Record<string, unknown> = { ...payload };
    for (const [name, def] of Object.entries(fieldDefaults)) {
      if (result[name] === undefined) result[name] = def;
    }
    return result;
  }

  function idFilter(id: EntityId) {
    const conditions = [eq(table["id"], id)];
    if (softDelete && table["isDeleted"]) {
      conditions.push(eq(table["isDeleted"], false));
    }
    return and(...conditions) as SQL;
  }

  async function loadById(id: EntityId, db: TenantDb): Promise<Record<string, unknown> | null> {
    const [row] = await db.select().from(table).where(idFilter(id));
    return (row as Record<string, unknown>) ?? null;
  }

  // Fire custom projections registered on this entity. Runs inside the same TX
  // as the event-append — projection failures throw, which rolls the event
  // append back as well. Quiet no-op when no registry is wired (tests, direct
  // executor usage).
  async function runProjections(
    event: StoredEvent,
    db: TenantDb,
    options: RuntimeOptions | undefined,
  ): Promise<void> {
    const registry = options?.registry;
    // skip: caller didn't opt into projections — legacy direct executor use
    if (!registry) return;
    const projections = registry.getProjectionsForSource(entityName);
    // skip: no projection feeds off this entity — fast path for the common case
    if (projections.length === 0) return;
    for (const proj of projections) {
      const applyFn = proj.apply[event.type];
      if (!applyFn) continue;
      await applyFn(event, db.raw);
    }
  }

  return {
    async create(payload, user, db, options) {
      // Respect an explicit id in the payload (seed pattern, SCIM import). Without
      // one the framework mints a fresh v4 UUID. Strip it out of the event payload
      // so defaults + downstream consumers don't see a redundant id field.
      const explicitId = typeof payload["id"] === "string" ? (payload["id"] as string) : undefined;
      const aggregateId = explicitId ?? uuid();
      const { id: _id, ...payloadWithoutId } = payload;
      const data = applyDefaults(payloadWithoutId);

      // 1. Append event (same TX as the projection write — both must succeed
      //    or both roll back; the dispatcher wraps both in one transaction).
      const event = await append(db.raw, {
        aggregateId,
        aggregateType: entityName,
        tenantId: user.tenantId,
        expectedVersion: 0,
        type: `${entityName}.created`,
        payload: data,
        metadata: { userId: String(user.id) },
      });

      // 2. Update projection. `version` echoes the event-store version so
      //    optimistic locking on the projection stays coherent with the event
      //    stream (a stale update() sees version=N and the stream is at N+1).
      const [row] = await db
        .insert(table)
        .values({
          ...data,
          id: aggregateId,
          version: event.version,
          insertedAt: event.createdAt,
          insertedById: user.id,
        })
        .returning();

      if (!row)
        return writeFailure(new InternalError({ message: "projection insert returned no row" }));
      const projection = row as Record<string, unknown>;

      await runProjections(event, db, options);

      if (entityCache && entityName) {
        await entityCache.del(user.tenantId, entityName, aggregateId);
      }

      return {
        isSuccess: true,
        data: {
          kind: "save",
          id: aggregateId,
          data: projection,
          changes: data,
          previous: {},
          isNew: true,
          entityName,
        },
      };
    },

    async update(payload, user, db, updateOptions) {
      const previous = await loadById(payload.id, db);
      if (!previous) return writeFailure(new NotFoundError(entityName, payload.id));

      const currentVersion = (previous["version"] as number) ?? 1;
      if (!updateOptions?.skipOptimisticLock) {
        if (payload.version === undefined) {
          return writeFailure(
            new FrameworkVersionConflict({
              entityId: payload.id,
              expectedVersion: 0,
              currentVersion,
            }),
          );
        }
        if (currentVersion !== payload.version) {
          return writeFailure(
            new FrameworkVersionConflict({
              entityId: payload.id,
              expectedVersion: payload.version,
              currentVersion,
            }),
          );
        }
      }

      try {
        const event = await append(db.raw, {
          aggregateId: String(payload.id),
          aggregateType: entityName,
          tenantId: user.tenantId,
          expectedVersion: currentVersion,
          type: `${entityName}.updated`,
          payload: payload.changes,
          metadata: { userId: String(user.id) },
        });

        const [row] = await db
          .update(table)
          .set({
            ...payload.changes,
            version: event.version,
            modifiedAt: event.createdAt,
            modifiedById: user.id,
          })
          .where(eq(table["id"], payload.id))
          .returning();

        if (!row)
          return writeFailure(new InternalError({ message: "projection update returned no row" }));
        const data = row as Record<string, unknown>;

        await runProjections(event, db, updateOptions);

        if (entityCache && entityName) {
          await entityCache.del(user.tenantId, entityName, payload.id);
        }

        return {
          isSuccess: true,
          data: {
            kind: "save",
            id: data["id"] as EntityId,
            data,
            changes: payload.changes,
            previous,
            isNew: false,
            entityName,
          },
        };
      } catch (e) {
        // The pre-check above eliminates the common stale-version case; this
        // branch catches the narrow race where two writers both read version=N
        // and both pass the local check — the unique index on (aggregate_id,
        // version) serializes them, one wins, the other lands here.
        if (e instanceof EventStoreVersionConflict) {
          return writeFailure(
            new FrameworkVersionConflict({
              entityId: payload.id,
              expectedVersion: payload.version ?? 0,
              currentVersion,
            }),
          );
        }
        throw e;
      }
    },

    async delete(payload, user, db, options) {
      const existing = await loadById(payload.id, db);
      if (!existing) return writeFailure(new NotFoundError(entityName, payload.id));

      const currentVersion = (existing["version"] as number) ?? 1;

      const event = await append(db.raw, {
        aggregateId: String(payload.id),
        aggregateType: entityName,
        tenantId: user.tenantId,
        expectedVersion: currentVersion,
        type: `${entityName}.deleted`,
        payload: {},
        metadata: { userId: String(user.id) },
      });

      if (softDelete) {
        await db
          .update(table)
          .set({
            isDeleted: true,
            deletedAt: event.createdAt,
            deletedById: user.id,
            version: event.version,
            modifiedAt: event.createdAt,
            modifiedById: user.id,
          })
          .where(eq(table["id"], payload.id));
      } else {
        await db.delete(table).where(eq(table["id"], payload.id));
      }

      await runProjections(event, db, options);

      if (entityCache && entityName) {
        await entityCache.del(user.tenantId, entityName, payload.id);
      }

      return {
        isSuccess: true,
        data: { kind: "delete", id: payload.id, data: existing, entityName },
      };
    },

    async restore(payload, user, db, options) {
      if (!softDelete) {
        return writeFailure(
          new UnprocessableError("soft_delete_not_enabled", {
            i18nKey: "errors.softDeleteNotEnabled",
          }),
        );
      }

      const [row] = await db.select().from(table).where(eq(table["id"], payload.id));
      if (!row) return writeFailure(new NotFoundError(entityName, payload.id));
      const data = row as Record<string, unknown>;
      if (!data["isDeleted"]) {
        return writeFailure(
          new UnprocessableError("not_deleted", { i18nKey: "errors.notDeleted" }),
        );
      }

      const currentVersion = (data["version"] as number) ?? 1;
      const event = await append(db.raw, {
        aggregateId: String(payload.id),
        aggregateType: entityName,
        tenantId: user.tenantId,
        expectedVersion: currentVersion,
        type: `${entityName}.restored`,
        payload: {},
        metadata: { userId: String(user.id) },
      });

      const [restored] = await db
        .update(table)
        .set({
          isDeleted: false,
          deletedAt: null,
          deletedById: null,
          version: event.version,
          modifiedAt: event.createdAt,
          modifiedById: user.id,
        })
        .where(eq(table["id"], payload.id))
        .returning();

      if (!restored)
        return writeFailure(new InternalError({ message: "projection restore returned no row" }));

      await runProjections(event, db, options);

      if (entityCache && entityName) {
        await entityCache.del(user.tenantId, entityName, payload.id);
      }

      return {
        isSuccess: true,
        data: {
          kind: "save",
          id: payload.id,
          data: restored as Record<string, unknown>,
          changes: { isDeleted: false },
          previous: data,
          isNew: false,
          entityName,
        },
      };
    },

    // list + detail are unchanged from crud-executor — projections are the
    // read-model and serve these queries directly.
    async list(payload, user, db) {
      const limit = payload.limit ?? 50;

      let filterIds: EntityId[] | undefined;
      if (payload.search && searchAdapter && entityName) {
        const results = await searchAdapter.search(user.tenantId, payload.search, {
          filterType: entityName,
        });
        filterIds = results.map((r) => r.entityId);
        if (filterIds.length === 0) return { rows: [], nextCursor: null };
      }

      const conditions: SQL[] = [];
      if (softDelete && table["isDeleted"]) {
        conditions.push(eq(table["isDeleted"], false));
      }
      if (payload.cursor) {
        conditions.push(gt(table["id"], decodeCursor(payload.cursor)));
      }
      if (filterIds) {
        conditions.push(inArray(table["id"], filterIds));
      }

      let query =
        conditions.length > 0
          ? db
              .select()
              .from(table)
              .where(and(...conditions) as SQL)
          : db.select().from(table);

      query = query.limit(limit);

      if (payload.sort && table[payload.sort]) {
        const column = table[payload.sort];
        query =
          payload.sortDirection === "desc"
            ? query.orderBy(desc(column))
            : query.orderBy(asc(column));
      }

      const rows = (await query) as Record<string, unknown>[];

      if (entityCache && entityName && rows.length > 0) {
        await entityCache.mset(
          user.tenantId,
          entityName,
          rows.map((r) => ({ id: r["id"] as EntityId, data: r })),
        );
      }

      const lastRow = rows[rows.length - 1];
      const nextCursor =
        rows.length === limit && lastRow ? encodeCursor(lastRow["id"] as number) : null;

      return { rows, nextCursor };
    },

    async detail(payload, user, db) {
      if (entityCache && entityName) {
        const cached = await entityCache.get(user.tenantId, entityName, payload.id);
        if (cached) return cached;
      }

      const row = await loadById(payload.id, db);
      if (!row) return null;

      if (entityCache && entityName) {
        await entityCache.set(user.tenantId, entityName, payload.id, row);
      }

      return row;
    },
  };
}
