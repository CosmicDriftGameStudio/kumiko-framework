import { fetchOne } from "../db/query";
import type { TenantId } from "../engine/types/identifiers";
import { NotFoundError } from "../errors";
import type { DbConnection } from "./connection";
import type { TenantDb } from "./tenant-db";

function isTenantDb(db: DbConnection | TenantDb): db is TenantDb {
  return typeof (db as TenantDb).fetchOne === "function" && "raw" in db;
}

/**
 * Generic constraint helper: asserts a value exists in a table.
 * Returns a ready-to-return NotFoundError when the row is missing, or null
 * when it exists. Callers typically use it with writeFailure:
 *
 *   const missing = await assertExistsIn(db, orderTable, { field: "id", value: id });
 *   if (missing) return writeFailure(missing);
 *
 * Accepts both DbConnection and TenantDb. When using TenantDb, the automatic
 * tenant filter is applied. Use tenantId option for explicit tenant filtering
 * on raw DbConnection.
 */
export async function assertExistsIn(
  db: DbConnection | TenantDb,
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle table types are dynamic
  entity: any,
  options: {
    field: string;
    value: unknown;
    tenantId?: TenantId;
    where?: Record<string, unknown>;
    entityName?: string;
  },
): Promise<NotFoundError | null> {
  const where: Record<string, unknown> = { [options.field]: options.value };
  if (options.tenantId !== undefined) where["tenantId"] = options.tenantId;
  if (options.where) Object.assign(where, options.where);

  const row = isTenantDb(db)
    ? await db.fetchOne(entity, where)
    : await fetchOne(db, entity, where);

  if (!row) {
    const entityName = options.entityName ?? String(options.field).replace(/Id$/, "");
    return new NotFoundError(
      entityName,
      typeof options.value === "number" || typeof options.value === "string"
        ? options.value
        : undefined,
    );
  }

  return null;
}
