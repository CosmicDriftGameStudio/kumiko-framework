import { and, eq } from "drizzle-orm";
import type { ValidationError } from "../engine/types";
import type { DbConnection } from "./connection";
import type { TenantDb } from "./tenant-db";

/**
 * Generic constraint helper: asserts a value exists in a table.
 * Works like a DB constraint with business logic — usable for any lookup table.
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
    tenantId?: number;
    where?: Record<string, unknown>;
    error?: string;
    errorField?: string;
  },
): Promise<ValidationError | null> {
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
    .where(and(...conditions));

  if (!row) {
    return {
      field: options.errorField ?? options.field,
      error: options.error ?? `${options.field}_not_found`,
    };
  }

  return null;
}
