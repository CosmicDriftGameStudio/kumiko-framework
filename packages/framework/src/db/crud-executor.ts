import { and, eq } from "drizzle-orm";
import type { PgTableWithColumns } from "drizzle-orm/pg-core";
import type { EntityDefinition, PipelineUser, WriteResult } from "../engine/types";
import { applyCursorQuery } from "./cursor";
import type { CursorResult, DbConnection } from "./index";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle dynamic tables
type Table = PgTableWithColumns<any>;

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
    payload: { cursor?: string | undefined; limit?: number | undefined; search?: string | undefined },
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
  searchableFields: readonly string[],
): CrudExecutor {
  const softDelete = entity.softDelete ?? false;

  function tenantAndId(tenantId: number, id: number) {
    const conditions = [eq(table["tenantId"], tenantId), eq(table["id"], id)];
    if (softDelete && table["isDeleted"]) {
      conditions.push(eq(table["isDeleted"], false));
    }
    return and(...conditions);
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
      return { isSuccess: true, data: row as Record<string, unknown> };
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
      return { isSuccess: true, data: row as Record<string, unknown> };
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
        return { isSuccess: true, data: true };
      }

      const [row] = await db
        .delete(table)
        .where(and(eq(table["tenantId"], user.tenantId), eq(table["id"], payload.id)))
        .returning();

      if (!row) return { isSuccess: false, error: "not_found" };
      return { isSuccess: true, data: true };
    },

    async list(payload, user, db) {
      const opts: Parameters<typeof applyCursorQuery>[2] = {
        tenantId: user.tenantId,
        searchColumns: searchableFields,
      };
      if (payload.cursor) opts.cursor = payload.cursor;
      if (payload.limit) opts.limit = payload.limit;
      if (payload.search) opts.search = payload.search;

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
