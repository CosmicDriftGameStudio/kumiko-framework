import { and, eq } from "drizzle-orm";
import type { PgTableWithColumns } from "drizzle-orm/pg-core";
import type {
  DeleteContext,
  EntityDefinition,
  PipelineUser,
  SaveContext,
  WriteResult,
} from "../engine/types";
import type { SearchAdapter } from "../search/types";
import { applyCursorQuery } from "./cursor";
import type { CursorResult, DbConnection } from "./index";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle dynamic tables
type Table = PgTableWithColumns<any>;

export type CrudExecutorOptions = {
  searchAdapter?: SearchAdapter;
  searchableFields?: readonly string[];
  entityName?: string;
};

export type CrudExecutor = {
  create: (
    payload: Record<string, unknown>,
    user: PipelineUser,
    db: DbConnection,
  ) => Promise<WriteResult<SaveContext>>;

  update: (
    payload: { id: number; version?: number; changes: Record<string, unknown> },
    user: PipelineUser,
    db: DbConnection,
  ) => Promise<WriteResult<SaveContext>>;

  delete: (
    payload: { id: number },
    user: PipelineUser,
    db: DbConnection,
  ) => Promise<WriteResult<DeleteContext>>;

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
  const { searchAdapter, searchableFields, entityName } = options;
  const searchWeight = entity.searchWeight ?? 1;

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

  async function indexForSearch(
    tenantId: number,
    id: number,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!searchAdapter || !searchableFields || !entityName) return;
    const fields: Record<string, unknown> = {};
    for (const f of searchableFields) {
      if (payload[f] !== undefined) fields[f] = payload[f];
    }
    await searchAdapter.index(tenantId, {
      entityType: entityName,
      entityId: id,
      weight: searchWeight,
      fields,
    });
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
      const id = data["id"] as number;

      await indexForSearch(user.tenantId, id, data);

      return {
        isSuccess: true,
        data: {
          id,
          data,
          changes: payload,
          previous: {},
          isNew: true,
        },
      };
    },

    async update(payload, user, db) {
      // Load previous state BEFORE update
      const previous = await loadById(user.tenantId, payload.id, db);
      if (!previous) return { isSuccess: false, error: "not_found" };

      // Optimistic locking: check version if provided
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
          ...payload.changes,
          version: currentVersion + 1,
          modifiedById: user.id,
          modifiedAt: new Date(),
        })
        .where(tenantAndId(user.tenantId, payload.id))
        .returning();

      if (!row) return { isSuccess: false, error: "update_failed" };
      const data = row as Record<string, unknown>;
      const id = data["id"] as number;

      await indexForSearch(user.tenantId, id, data);

      return {
        isSuccess: true,
        data: {
          id,
          data,
          changes: payload.changes,
          previous,
          isNew: false,
        },
      };
    },

    async delete(payload, user, db) {
      // Load data before delete for hooks
      const existing = await loadById(user.tenantId, payload.id, db);
      if (!existing) return { isSuccess: false, error: "not_found" };

      if (softDelete) {
        await db
          .update(table)
          .set({
            isDeleted: true,
            modifiedById: user.id,
            modifiedAt: new Date(),
          })
          .where(tenantAndId(user.tenantId, payload.id))
          .returning();
      } else {
        await db
          .delete(table)
          .where(and(eq(table["tenantId"], user.tenantId), eq(table["id"], payload.id)));
      }

      if (searchAdapter && entityName) {
        await searchAdapter.remove(user.tenantId, entityName, payload.id);
      }

      return {
        isSuccess: true,
        data: { id: payload.id, data: existing },
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

      // Search goes through SearchAdapter — tenant-scoped, type-filtered
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

      return {
        rows: rows as Record<string, unknown>[],
        nextCursor,
      };
    },

    async detail(payload, user, db) {
      return loadById(user.tenantId, payload.id, db);
    },
  };
}
