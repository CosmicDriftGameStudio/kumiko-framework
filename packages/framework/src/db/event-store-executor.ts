import { and, asc, desc, eq, gt, inArray, type SQL } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import type {
  DeleteContext,
  EntityDefinition,
  EntityId,
  FieldDefinition,
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
import { append, VersionConflictError as EventStoreVersionConflict } from "../event-store";
import type { EntityCache } from "../pipeline/entity-cache";
import type { SearchAdapter } from "../search/types";
import type { DbRow } from "./connection";
import { decodeCursor, encodeCursor } from "./cursor";
import type { TableColumns } from "./dialect";
import type { CursorResult } from "./index";
import type { TenantDb } from "./tenant-db";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle dynamic tables
type Table = TableColumns<any>;

// Returns the scalar default of a field, or undefined if the field's type
// doesn't carry a default or no default was declared. Only scalar types
// (text/number/boolean/select) support creation-time defaults — money/date/
// file/embedded fields don't.
function scalarDefault(field: FieldDefinition): unknown {
  switch (field.type) {
    case "text":
    case "number":
    case "boolean":
    case "select":
      return field.default;
    default:
      return undefined;
  }
}

export type EventStoreExecutorOptions = {
  searchAdapter?: SearchAdapter;
  entityName: string; // required — the aggregateType marker on every event
  entityCache?: EntityCache;
};

// The executor writes events + auto-projection (entity table) in one TX.
// It no longer knows about user projections — those are driven by the
// pipeline, which reads the StoredEvent surfaced on SaveContext/DeleteContext
// and iterates the registry itself. Executor-level `registry` options were
// removed to close the silent-bypass hole where a caller forgetting to pass
// one would skip projections without any signal.
export type EventStoreExecutor = {
  create: (
    payload: Record<string, unknown>,
    user: SessionUser,
    db: TenantDb,
  ) => Promise<WriteResult<SaveContext>>;

  update: (
    payload: { id: EntityId; version?: number | undefined; changes: Record<string, unknown> },
    user: SessionUser,
    db: TenantDb,
    options?: { skipOptimisticLock?: boolean },
  ) => Promise<WriteResult<SaveContext>>;

  delete: (
    payload: { id: EntityId },
    user: SessionUser,
    db: TenantDb,
  ) => Promise<WriteResult<DeleteContext>>;

  restore: (
    payload: { id: EntityId },
    user: SessionUser,
    db: TenantDb,
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
    const def = scalarDefault(field);
    if (def !== undefined) fieldDefaults[name] = def;
  }

  // Pre-compute the set of sensitive field names once. Every event payload
  // (create data, update changes + previous, delete previous, restore
  // previous) strips these before writing to the immutable event log. Keeps
  // GDPR right-to-be-forgotten tractable — only entity rows hold the
  // sensitive data, and entity rows can be deleted / re-encrypted.
  const sensitiveFields = new Set<string>();
  for (const [name, field] of Object.entries(entity.fields)) {
    if ("sensitive" in field && field.sensitive === true) {
      sensitiveFields.add(name);
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

  function stripSensitive(payload: Record<string, unknown> | undefined): Record<string, unknown> {
    if (!payload) return {};
    if (sensitiveFields.size === 0) return payload;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (sensitiveFields.has(key)) continue;
      result[key] = value;
    }
    return result;
  }

  function idFilter(id: EntityId) {
    const conditions = [eq(table["id"], id)];
    if (softDelete && table["isDeleted"]) {
      conditions.push(eq(table["isDeleted"], false));
    }
    // Drizzle's variadic `and()` is typed `SQL | undefined`; conditions is
    // guaranteed non-empty above (we pushed at least one).
    return and(...conditions) as SQL;
  }

  async function loadById(id: EntityId, db: TenantDb): Promise<Record<string, unknown> | null> {
    const [row] = await db.select().from(table).where(idFilter(id));
    return (row as DbRow) ?? null;
  }

  return {
    async create(payload, user, db) {
      // Respect an explicit id in the payload (seed pattern, SCIM import). Without
      // one the framework mints a fresh v4 UUID. Strip it out of the event payload
      // so defaults + downstream consumers don't see a redundant id field.
      const explicitId = typeof payload["id"] === "string" ? (payload["id"] as string) : undefined;
      const aggregateId = explicitId ?? uuid();
      const { id: _id, ...payloadWithoutId } = payload;
      const data = applyDefaults(payloadWithoutId);

      // 1. Append event (same TX as the projection write — both must succeed
      //    or both roll back; the dispatcher wraps both in one transaction).
      //    Sensitive fields are stripped from the event payload; the entity
      //    row below still receives the full data.
      const event = await append(db.raw, {
        aggregateId,
        aggregateType: entityName,
        tenantId: user.tenantId,
        expectedVersion: 0,
        type: `${entityName}.created`,
        payload: stripSensitive(data),
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
      const projection = row as DbRow;

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
          event,
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
        // The event payload carries BOTH `changes` (what the user asked for) AND
        // `previous` (the pre-update row). Cross-aggregate projections need the
        // previous value to decrement/undo when a parent-FK moves — without it
        // you'd have to snapshot-and-diff on every apply, and replays would
        // break. Storage cost is acceptable (rows are bounded), correctness is
        // not negotiable. Sensitive fields are stripped from BOTH halves so
        // they never reach the immutable event log.
        const event = await append(db.raw, {
          aggregateId: String(payload.id),
          aggregateType: entityName,
          tenantId: user.tenantId,
          expectedVersion: currentVersion,
          type: `${entityName}.updated`,
          payload: {
            changes: stripSensitive(payload.changes),
            previous: stripSensitive(previous),
          },
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
        const data = row as DbRow;

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
            event,
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

    async delete(payload, user, db) {
      const existing = await loadById(payload.id, db);
      if (!existing) return writeFailure(new NotFoundError(entityName, payload.id));

      const currentVersion = (existing["version"] as number) ?? 1;

      // Deletes carry the full pre-delete row as `previous`. That's what
      // projections and downstream consumers need to reverse any aggregates —
      // a `{}`-payload delete would make cross-aggregate projections impossible
      // to rebuild from the event log alone. Sensitive fields are stripped.
      const event = await append(db.raw, {
        aggregateId: String(payload.id),
        aggregateType: entityName,
        tenantId: user.tenantId,
        expectedVersion: currentVersion,
        type: `${entityName}.deleted`,
        payload: { previous: stripSensitive(existing) },
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

      if (entityCache && entityName) {
        await entityCache.del(user.tenantId, entityName, payload.id);
      }

      return {
        isSuccess: true,
        data: { kind: "delete", id: payload.id, data: existing, entityName, event },
      };
    },

    async restore(payload, user, db) {
      if (!softDelete) {
        return writeFailure(
          new UnprocessableError("soft_delete_not_enabled", {
            i18nKey: "errors.softDeleteNotEnabled",
          }),
        );
      }

      const [row] = await db.select().from(table).where(eq(table["id"], payload.id));
      if (!row) return writeFailure(new NotFoundError(entityName, payload.id));
      const data = row as DbRow;
      if (!data["isDeleted"]) {
        return writeFailure(
          new UnprocessableError("not_deleted", { i18nKey: "errors.notDeleted" }),
        );
      }

      const currentVersion = (data["version"] as number) ?? 1;
      // Restore carries the soft-deleted snapshot as `previous` — mirror of
      // delete for symmetry. Projections that decremented on delete use
      // `previous` to re-increment on restore without re-querying the entity
      // table. Sensitive fields are stripped.
      const event = await append(db.raw, {
        aggregateId: String(payload.id),
        aggregateType: entityName,
        tenantId: user.tenantId,
        expectedVersion: currentVersion,
        type: `${entityName}.restored`,
        payload: { previous: stripSensitive(data) },
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

      if (entityCache && entityName) {
        await entityCache.del(user.tenantId, entityName, payload.id);
      }

      return {
        isSuccess: true,
        data: {
          kind: "save",
          id: payload.id,
          data: restored as DbRow,
          changes: { isDeleted: false },
          previous: data,
          isNew: false,
          entityName,
          event,
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
