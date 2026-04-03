import { and, eq } from "drizzle-orm";
import type { TableColumns } from "./dialect";
import type {
  DeleteContext,
  EntityDefinition,
  SessionUser,
  SaveContext,
  WriteResult,
} from "../engine/types";
import type { SearchAdapter } from "../search/types";
import { applyCursorQuery } from "./cursor";
import type { CursorResult, DbConnection } from "./index";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle dynamic tables
type Table = TableColumns<any>;

export type CrudExecutorOptions = {
  searchAdapter?: SearchAdapter;
  entityName?: string;
  encryptionProvider?: EncryptionProvider;
};

type EncryptionProvider = {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
};

export type CrudExecutor = {
  create: (
    payload: Record<string, unknown>,
    user: SessionUser,
    db: DbConnection,
  ) => Promise<WriteResult<SaveContext>>;

  update: (
    payload: { id: number; version?: number | undefined; changes: Record<string, unknown> },
    user: SessionUser,
    db: DbConnection,
  ) => Promise<WriteResult<SaveContext>>;

  delete: (
    payload: { id: number },
    user: SessionUser,
    db: DbConnection,
  ) => Promise<WriteResult<DeleteContext>>;

  restore: (
    payload: { id: number },
    user: SessionUser,
    db: DbConnection,
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
    db: DbConnection,
  ) => Promise<CursorResult<Record<string, unknown>>>;

  detail: (
    payload: { id: number },
    user: SessionUser,
    db: DbConnection,
  ) => Promise<Record<string, unknown> | null>;
};

export function createCrudExecutor(
  table: Table,
  entity: EntityDefinition,
  options: CrudExecutorOptions = {},
): CrudExecutor {
  const softDelete = entity.softDelete ?? false;
  const { searchAdapter, entityName, encryptionProvider } = options;

  // Find fields that need encryption
  const encryptedFields = new Set<string>();
  for (const [name, field] of Object.entries(entity.fields)) {
    if (field.type === "text" && field.encrypted) {
      encryptedFields.add(name);
    }
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

  function decryptRow(row: Record<string, unknown>): Record<string, unknown> {
    if (!encryptionProvider || encryptedFields.size === 0) return row;
    const result = { ...row };
    for (const field of encryptedFields) {
      if (typeof result[field] === "string") {
        result[field] = encryptionProvider.decrypt(result[field] as string);
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

  function tenantAndId(tenantId: number, id: number) {
    const conditions = [eq(table["tenantId"], tenantId), eq(table["id"], id)];
    if (softDelete && table["isDeleted"]) {
      conditions.push(eq(table["isDeleted"], false));
    }
    return and(...conditions);
  }

  async function loadById(
    tenantId: number,
    id: number,
    db: DbConnection,
  ): Promise<Record<string, unknown> | null> {
    const [row] = await db.select().from(table).where(tenantAndId(tenantId, id));
    return (row as Record<string, unknown>) ?? null;
  }

  return {
    async create(payload, user, db) {
      const [row] = await db
        .insert(table)
        .values({
          ...encryptPayload(payload),
          tenantId: user.tenantId,
          insertedById: user.id,
          insertedAt: new Date(),
        })
        .returning();

      if (!row) return { isSuccess: false, error: "insert_failed" };
      const data = row as Record<string, unknown>;
      const id = data["id"] as number;

      return {
        isSuccess: true,
        data: { id, data, changes: payload, previous: {}, isNew: true },
      };
    },

    async update(payload, user, db) {
      const previous = await loadById(user.tenantId, payload.id, db);
      if (!previous) return { isSuccess: false, error: "not_found" };

      if (payload.version !== undefined) {
        const currentVersion = previous["version"] as number;
        if (currentVersion !== payload.version) {
          return {
            isSuccess: false,
            error: `version_conflict: expected ${payload.version}, current ${currentVersion}`,
          };
        }
      }

      const currentVersion = (previous["version"] as number) ?? 1;
      const [row] = await db
        .update(table)
        .set({
          ...encryptPayload(payload.changes),
          version: currentVersion + 1,
          modifiedById: user.id,
          modifiedAt: new Date(),
        })
        .where(tenantAndId(user.tenantId, payload.id))
        .returning();

      if (!row) return { isSuccess: false, error: "update_failed" };
      const data = row as Record<string, unknown>;

      return {
        isSuccess: true,
        data: {
          id: data["id"] as number,
          data,
          changes: payload.changes,
          previous,
          isNew: false,
        },
      };
    },

    async delete(payload, user, db) {
      const existing = await loadById(user.tenantId, payload.id, db);
      if (!existing) return { isSuccess: false, error: "not_found" };

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
          .where(tenantAndId(user.tenantId, payload.id));
      } else {
        await db
          .delete(table)
          .where(and(eq(table["tenantId"], user.tenantId), eq(table["id"], payload.id)));
      }

      return { isSuccess: true, data: { id: payload.id, data: existing } };
    },

    async restore(payload, user, db) {
      if (!softDelete) return { isSuccess: false, error: "soft_delete_not_enabled" };

      // Find the soft-deleted row (bypass isDeleted filter)
      const [row] = await db
        .select()
        .from(table)
        .where(and(eq(table["tenantId"], user.tenantId), eq(table["id"], payload.id)));

      if (!row) return { isSuccess: false, error: "not_found" };
      const data = row as Record<string, unknown>;
      if (!data["isDeleted"]) return { isSuccess: false, error: "not_deleted" };

      const [restored] = await db
        .update(table)
        .set({
          isDeleted: false,
          deletedAt: null,
          deletedById: null,
          modifiedById: user.id,
          modifiedAt: new Date(),
        })
        .where(and(eq(table["tenantId"], user.tenantId), eq(table["id"], payload.id)))
        .returning();

      if (!restored) return { isSuccess: false, error: "restore_failed" };
      const restoredData = restored as Record<string, unknown>;

      return {
        isSuccess: true,
        data: {
          id: payload.id,
          data: restoredData,
          changes: { isDeleted: false },
          previous: data,
          isNew: false,
        },
      };
    },

    async list(payload, user, db) {
      const opts: Parameters<typeof applyCursorQuery>[2] = {
        tenantId: user.tenantId,
      };
      if (payload.cursor) opts.cursor = payload.cursor;
      if (payload.limit) opts.limit = payload.limit;
      if (payload.sort) opts.sort = payload.sort;
      if (payload.sortDirection) opts.sortDirection = payload.sortDirection;

      // Search through SearchAdapter — tenant-scoped, type-filtered
      if (payload.search && searchAdapter && entityName) {
        const results = await searchAdapter.search(user.tenantId, payload.search, {
          filterType: entityName,
        });
        const ids = results.map((r) => r.entityId);
        if (ids.length === 0) return { rows: [], nextCursor: null };
        opts.filterIds = ids;
      }

      const rows = await applyCursorQuery(db.select().from(table).$dynamic(), table, opts);

      const limit = payload.limit ?? 50;
      const lastRow = rows[rows.length - 1] as Record<string, unknown> | undefined;
      const nextCursor =
        rows.length === limit && lastRow
          ? Buffer.from(String(lastRow["id"])).toString("base64url")
          : null;

      return { rows: (rows as Record<string, unknown>[]).map(maskRow), nextCursor };
    },

    async detail(payload, user, db) {
      const row = await loadById(user.tenantId, payload.id, db);
      return row ? maskRow(row) : null;
    },
  };
}
