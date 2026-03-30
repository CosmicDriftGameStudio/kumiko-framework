import { and, eq } from "drizzle-orm";
import type { PgTableWithColumns } from "drizzle-orm/pg-core";
import type { EntityDefinition, PipelineUser, WriteResult } from "../engine/types";
import type { SearchAdapter } from "../search/types";
import { applyCursorQuery } from "./cursor";
import type { CursorResult, DbConnection } from "./index";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle dynamic tables
type Table = PgTableWithColumns<any>;

export type CrudExecutorOptions = {
  searchAdapter?: SearchAdapter;
  searchableFields?: readonly string[];
};

export type CrudExecutor = {
  create: (
    payload: Record<string, unknown>,
    user: PipelineUser,
    db: DbConnection,
  ) => Promise<WriteResult<Record<string, unknown>>>;

  update: (
    payload: { id: number; changes: Record<string, unknown> },
    user: PipelineUser,
    db: DbConnection,
  ) => Promise<WriteResult<Record<string, unknown>>>;

  delete: (
    payload: { id: number },
    user: PipelineUser,
    db: DbConnection,
  ) => Promise<WriteResult<boolean>>;

  list: (
    payload: {
      cursor?: string | undefined;
      limit?: number | undefined;
      search?: string | undefined;
      sort?: string | undefined;
      sortDirection?: "asc" | "desc" | undefined;
    },
    user: PipelineUser,
    db: DbConnection,
  ) => Promise<CursorResult<Record<string, unknown>>>;

  detail: (
    payload: { id: number },
    user: PipelineUser,
    db: DbConnection,
  ) => Promise<Record<string, unknown> | null>;
};

export function createCrudExecutor(
  table: Table,
  entity: EntityDefinition,
  options: CrudExecutorOptions = {},
): CrudExecutor {
  const softDelete = entity.softDelete ?? false;
  const { searchAdapter, searchableFields } = options;

  function tenantAndId(tenantId: number, id: number) {
    const conditions = [eq(table["tenantId"], tenantId), eq(table["id"], id)];
    if (softDelete && table["isDeleted"]) {
      conditions.push(eq(table["isDeleted"], false));
    }
    return and(...conditions);
  }

  async function indexForSearch(id: number, payload: Record<string, unknown>): Promise<void> {
    if (!searchAdapter || !searchableFields) return;
    const fields: Record<string, unknown> = {};
    for (const f of searchableFields) {
      if (payload[f] !== undefined) fields[f] = payload[f];
    }
    await searchAdapter.index(entity.table, id, fields);
  }

  return {
    async create(payload, user, db) {
      const [row] = await db
        .insert(table)
        .values({
          ...payload,
          tenantId: user.tenantId,
          insertedById: user.id,
          insertedAt: new Date(),
        })
        .returning();

      if (!row) return { isSuccess: false, error: "insert_failed" };
      const data = row as Record<string, unknown>;
      await indexForSearch(data["id"] as number, data);
      return { isSuccess: true, data };
    },

    async update(payload, user, db) {
      const [row] = await db
        .update(table)
        .set({
          ...payload.changes,
          modifiedById: user.id,
          modifiedAt: new Date(),
        })
        .where(tenantAndId(user.tenantId, payload.id))
        .returning();

      if (!row) return { isSuccess: false, error: "not_found" };
      const data = row as Record<string, unknown>;
      await indexForSearch(data["id"] as number, data);
      return { isSuccess: true, data };
    },

    async delete(payload, user, db) {
      if (softDelete) {
        const [row] = await db
          .update(table)
          .set({
            isDeleted: true,
            modifiedById: user.id,
            modifiedAt: new Date(),
          })
          .where(tenantAndId(user.tenantId, payload.id))
          .returning();

        if (!row) return { isSuccess: false, error: "not_found" };
        if (searchAdapter) await searchAdapter.remove(entity.table, payload.id);
        return { isSuccess: true, data: true };
      }

      const [row] = await db
        .delete(table)
        .where(and(eq(table["tenantId"], user.tenantId), eq(table["id"], payload.id)))
        .returning();

      if (!row) return { isSuccess: false, error: "not_found" };
      if (searchAdapter) await searchAdapter.remove(entity.table, payload.id);
      return { isSuccess: true, data: true };
    },

    async list(payload, user, db) {
      const opts: Parameters<typeof applyCursorQuery>[2] = {
        tenantId: user.tenantId,
      };
      if (payload.cursor) opts.cursor = payload.cursor;
      if (payload.limit) opts.limit = payload.limit;
      if (payload.sort) opts.sort = payload.sort;
      if (payload.sortDirection) opts.sortDirection = payload.sortDirection;

      // Search goes through SearchAdapter, not SQL
      if (payload.search && searchAdapter) {
        const ids = await searchAdapter.search(entity.table, payload.search);
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

      return {
        rows: rows as Record<string, unknown>[],
        nextCursor,
      };
    },

    async detail(payload, user, db) {
      const [row] = await db.select().from(table).where(tenantAndId(user.tenantId, payload.id));

      return (row as Record<string, unknown>) ?? null;
    },
  };
}
