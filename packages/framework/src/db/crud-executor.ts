import { and, asc, desc, eq, gt, inArray, type SQL } from "drizzle-orm";
import type {
  DeleteContext,
  EntityDefinition,
  EntityId,
  SaveContext,
  SessionUser,
  WriteResult,
} from "../engine/types";
import {
  InternalError,
  NotFoundError,
  UnprocessableError,
  VersionConflictError,
  writeFailure,
} from "../errors";
import type { EntityCache } from "../pipeline/entity-cache";
import type { SearchAdapter } from "../search/types";
import { decodeCursor, encodeCursor } from "./cursor";
import type { TableColumns } from "./dialect";
import type { CursorResult } from "./index";
import type { TenantDb } from "./tenant-db";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle dynamic tables
type Table = TableColumns<any>;

export type CrudExecutorOptions = {
  searchAdapter?: SearchAdapter;
  entityName?: string;
  encryptionProvider?: EncryptionProvider;
  entityCache?: EntityCache;
};

type EncryptionProvider = {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
};

export type CrudExecutor = {
  create: (
    payload: Record<string, unknown>,
    user: SessionUser,
    db: TenantDb,
  ) => Promise<WriteResult<SaveContext>>;

  update: (
    payload: { id: EntityId; version?: number | undefined; changes: Record<string, unknown> },
    user: SessionUser,
    db: TenantDb,
    // Server-only options. Intentionally NOT part of `payload` — otherwise a
    // client could send `skipOptimisticLock: true` over the wire and bypass
    // optimistic locking entirely. Only the handler decides.
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

export function createCrudExecutor(
  table: Table,
  entity: EntityDefinition,
  options: CrudExecutorOptions = {},
): CrudExecutor {
  const softDelete = entity.softDelete ?? false;
  const { searchAdapter, entityName, encryptionProvider, entityCache } = options;

  // Find fields that need encryption
  const encryptedFields = new Set<string>();
  for (const [name, field] of Object.entries(entity.fields)) {
    if (field.type === "text" && field.encrypted) {
      encryptedFields.add(name);
    }
  }

  // Pre-compute fields with defaults so create() can fill them in when the
  // client-supplied payload is missing them. Defaults are only applied at
  // insert time — updates don't re-apply defaults for fields left untouched.
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

  function encryptPayload(payload: Record<string, unknown>): Record<string, unknown> {
    if (!encryptionProvider || encryptedFields.size === 0) return payload;
    const result = { ...payload };
    for (const field of encryptedFields) {
      if (typeof result[field] === "string") {
        result[field] = encryptionProvider.encrypt(result[field] as string);
      }
    }
    return result;
  }

  function maskRow(row: Record<string, unknown>): Record<string, unknown> {
    if (encryptedFields.size === 0) return row;
    const result = { ...row };
    for (const field of encryptedFields) {
      if (result[field] !== undefined && result[field] !== null) {
        result[field] = "••••••";
      }
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

  return {
    async create(payload, user, db) {
      const [row] = await db
        .insert(table)
        .values({
          ...encryptPayload(applyDefaults(payload)),
          insertedById: user.id,
          insertedAt: new Date(),
        })
        .returning();

      if (!row) return writeFailure(new InternalError({ message: "insert returned no row" }));
      const data = row as Record<string, unknown>;
      const id = data["id"] as EntityId;

      // Invalidate rather than write-through: if the surrounding pipeline
      // rolls back (postSave hook failure, outbox commit failure), a populated
      // cache would serve values that never landed in the DB.
      if (entityCache && entityName) {
        await entityCache.del(user.tenantId, entityName, id);
      }

      return {
        isSuccess: true,
        data: { kind: "save", id, data, changes: payload, previous: {}, isNew: true, entityName },
      };
    },

    async update(payload, user, db, options) {
      const previous = await loadById(payload.id, db);
      if (!previous) return writeFailure(new NotFoundError(entityName ?? "entity", payload.id));

      // Every entity carries a `version` column. Skipping the optimistic-lock
      // check when the client forgets to send one turns stale writes into a
      // silent last-writer-wins. Default: a missing `version` is a conflict.
      // Callers that consciously accept last-writer-wins (admin ops, migration
      // scripts, automation) can opt out via options.skipOptimisticLock — this
      // is intentionally a server-side flag, not a payload field, so a client
      // cannot disable optimistic locking by sending it over the wire.
      const currentVersion = (previous["version"] as number) ?? 1;
      if (!options?.skipOptimisticLock) {
        if (payload.version === undefined) {
          return writeFailure(
            new VersionConflictError({
              entityId: payload.id,
              expectedVersion: 0,
              currentVersion,
            }),
          );
        }
        if (currentVersion !== payload.version) {
          return writeFailure(
            new VersionConflictError({
              entityId: payload.id,
              expectedVersion: payload.version,
              currentVersion,
            }),
          );
        }
      }
      const [row] = await db
        .update(table)
        .set({
          ...encryptPayload(payload.changes),
          version: currentVersion + 1,
          modifiedById: user.id,
          modifiedAt: new Date(),
        })
        .where(eq(table["id"], payload.id))
        .returning();

      if (!row) return writeFailure(new InternalError({ message: "update returned no row" }));
      const data = row as Record<string, unknown>;

      // Invalidate rather than write-through (see create() for rationale).
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
    },

    async delete(payload, user, db) {
      const existing = await loadById(payload.id, db);
      if (!existing) return writeFailure(new NotFoundError(entityName ?? "entity", payload.id));

      if (softDelete) {
        await db
          .update(table)
          .set({
            isDeleted: true,
            deletedAt: new Date(),
            deletedById: user.id,
            modifiedById: user.id,
            modifiedAt: new Date(),
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
        data: { kind: "delete", id: payload.id, data: existing, entityName },
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

      // Find the soft-deleted row (bypass isDeleted filter — use only id)
      const [row] = await db.select().from(table).where(eq(table["id"], payload.id));

      if (!row) return writeFailure(new NotFoundError(entityName ?? "entity", payload.id));
      const data = row as Record<string, unknown>;
      if (!data["isDeleted"]) {
        return writeFailure(
          new UnprocessableError("not_deleted", { i18nKey: "errors.notDeleted" }),
        );
      }

      const [restored] = await db
        .update(table)
        .set({
          isDeleted: false,
          deletedAt: null,
          deletedById: null,
          modifiedById: user.id,
          modifiedAt: new Date(),
        })
        .where(eq(table["id"], payload.id))
        .returning();

      if (!restored) return writeFailure(new InternalError({ message: "restore returned no row" }));
      const restoredData = restored as Record<string, unknown>;

      if (entityCache && entityName) {
        await entityCache.del(user.tenantId, entityName, payload.id);
      }

      return {
        isSuccess: true,
        data: {
          kind: "save",
          id: payload.id,
          data: restoredData,
          changes: { isDeleted: false },
          previous: data,
          isNew: false,
          entityName,
        },
      };
    },

    async list(payload, user, db) {
      const limit = payload.limit ?? 50;

      // Search through SearchAdapter — tenant-scoped, type-filtered
      let filterIds: EntityId[] | undefined;
      if (payload.search && searchAdapter && entityName) {
        const results = await searchAdapter.search(user.tenantId, payload.search, {
          filterType: entityName,
        });
        filterIds = results.map((r) => r.entityId);
        if (filterIds.length === 0) return { rows: [], nextCursor: null };
      }

      // Build WHERE conditions (tenant filter is automatic via TenantDb)
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

      // Fill cache with loaded rows (detail queries benefit from this)
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

      return { rows: rows.map(maskRow), nextCursor };
    },

    async detail(payload, user, db) {
      // Cache check
      if (entityCache && entityName) {
        const cached = await entityCache.get(user.tenantId, entityName, payload.id);
        if (cached) return maskRow(cached);
      }

      const row = await loadById(payload.id, db);
      if (!row) return null;

      // Cache fill
      if (entityCache && entityName) {
        await entityCache.set(user.tenantId, entityName, payload.id, row);
      }

      return maskRow(row);
    },
  };
}
