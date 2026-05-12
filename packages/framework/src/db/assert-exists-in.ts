import type { TenantId } from "../engine/types/identifiers";
import { and, eq, type SQL } from "drizzle-orm";
import { NotFoundError } from "../errors";
import type { DbConnection } from "./connection";
import type { TenantDb } from "./tenant-db";

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
  const conditions = [eq(entity[options.field], options.value)];

  if (options.tenantId !== undefined) {
    conditions.push(eq(entity["tenantId"], options.tenantId));
  }

  if (options.where) {
    for (const [key, val] of Object.entries(options.where)) {
      conditions.push(eq(entity[key], val));
    }
  }

  const [row] = await db
    .select()
    .from(entity)
    .where(and(...conditions) as SQL); // @cast-boundary db-operator

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
