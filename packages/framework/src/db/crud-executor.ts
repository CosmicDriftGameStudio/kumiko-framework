import { and, asc, desc, eq, gt, inArray, type SQL } from "drizzle-orm";
import type {
  DeleteContext,
  EntityDefinition,
  SaveContext,
  SessionUser,
  WriteResult,
} from "../engine/types";
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
    payload: { id: number; version?: number | undefined; changes: Record<string, unknown> },
    user: SessionUser,
    db: TenantDb,
  ) => Promise<WriteResult<SaveContext>>;

  delete: (
    payload: { id: number },
    user: SessionUser,
    db: TenantDb,
  ) => Promise<WriteResult<DeleteContext>>;

  restore: (
    payload: { id: number },
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
    payload: { id: number },
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

  function _decryptRow(row: Record<string, unknown>): Record<string, unknown> {
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

  function idFilter(id: number) {
    const conditions = [eq(table["id"], id)];
    if (softDelete && table["isDeleted"]) {
      conditions.push(eq(table["isDeleted"], false));
    }
    return and(...conditions)!;
  }

  async function loadById(id: number, db: TenantDb): Promise<Record<string, unknown> | null> {
    const [row] = await db.select().from(table).where(idFilter(id));
    return (row as Record<string, unknown>) ?? null;
  }

  return {
    async create(payload, user, db) {
      const [row] = await db
        .insert(table)
        .values({
          ...encryptPayload(payload),
          insertedById: user.id,
          insertedAt: new Date(),
        })
        .returning();

      if (!row) return { isSuccess: false, error: "insert_failed" };
      const data = row as Record<string, unknown>;
      const id = data["id"] as number;

      return {
        isSuccess: true,
        data: { kind: "save", id, data, changes: payload, previous: {}, isNew: true, entityName },
      };
    },

    async update(payload, user, db) {
      const previous = await loadById(payload.id, db);
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
        .where(eq(table["id"], payload.id))
        .returning();

      if (!row) return { isSuccess: false, error: "update_failed" };
      const data = row as Record<string, unknown>;

      return {
        isSuccess: true,
        data: {
          kind: "save",
          id: data["id"] as number,
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
          .where(eq(table["id"], payload.id));
      } else {
        await db.delete(table).where(eq(table["id"], payload.id));
      }

      return {
        isSuccess: true,
        data: { kind: "delete", id: payload.id, data: existing, entityName },
      };
    },

    async restore(payload, user, db) {
      if (!softDelete) return { isSuccess: false, error: "soft_delete_not_enabled" };

      // Find the soft-deleted row (bypass isDeleted filter — use only id)
      const [row] = await db.select().from(table).where(eq(table["id"], payload.id));

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
        .where(eq(table["id"], payload.id))
        .returning();

      if (!restored) return { isSuccess: false, error: "restore_failed" };
      const restoredData = restored as Record<string, unknown>;

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
      let filterIds: number[] | undefined;
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
              .where(and(...conditions)!)
          : db.select().from(table);

      query = query.limit(limit);

      if (payload.sort && table[payload.sort]) {
        const column = table[payload.sort];
        query =
          payload.sortDirection === "desc"
            ? query.orderBy(desc(column))
            : query.orderBy(asc(column));
      }

      const rows = await query;

      const lastRow = rows[rows.length - 1] as Record<string, unknown> | undefined;
      const nextCursor =
        rows.length === limit && lastRow ? encodeCursor(lastRow["id"] as number) : null;

      return { rows: (rows as Record<string, unknown>[]).map(maskRow), nextCursor };
    },

    async detail(payload, _user, db) {
      const row = await loadById(payload.id, db);
      return row ? maskRow(row) : null;
    },
  };
}
