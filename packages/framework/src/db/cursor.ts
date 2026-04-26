import type { TenantId } from "@kumiko/framework/engine";
import { and, asc, desc, eq, gt, inArray, type SQL } from "drizzle-orm";
import type { SelectQuery as PgSelect } from "./dialect";

export type CursorQueryOptions = {
  tenantId: TenantId;
  cursor?: string;
  limit?: number;
  filterIds?: readonly number[];
  sort?: string;
  sortDirection?: "asc" | "desc";
  extraWhere?: SQL;
};

export type CursorResult<T> = {
  rows: T[];
  nextCursor: string | null;
  /** Optional total row count — nur present wenn der Caller `totalCount: true`
   *  in der Query setzt. Pager-UI braucht's für "Page X of Y"; Infinite-
   *  Scroll und Default-Lists lassen den extra COUNT(*) weg. */
  total?: number;
};

export function encodeCursor(id: number): string {
  return Buffer.from(id.toString()).toString("base64url");
}

export function decodeCursor(cursor: string): number {
  const decoded = Buffer.from(cursor, "base64url").toString();
  const id = Number.parseInt(decoded, 10);
  if (Number.isNaN(id)) throw new Error(`Invalid cursor: ${cursor}`);
  return id;
}

export function applyCursorQuery<T extends PgSelect>(
  query: T,
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle dynamic tables lose column types
  table: any,
  options: CursorQueryOptions,
): T {
  const conditions: SQL[] = [eq(table.tenantId, options.tenantId)];

  if (table.isDeleted) {
    conditions.push(eq(table.isDeleted, false));
  }

  if (options.cursor) {
    conditions.push(gt(table.id, decodeCursor(options.cursor)));
  }

  if (options.filterIds !== undefined) {
    if (options.filterIds.length === 0) {
      // No matching IDs — return empty result
      conditions.push(eq(table.id, -1));
    } else {
      conditions.push(inArray(table.id, options.filterIds as number[]));
    }
  }

  if (options.extraWhere) {
    conditions.push(options.extraWhere);
  }

  const limit = options.limit ?? 50;

  let result = query.where(and(...conditions)).limit(limit);

  if (options.sort && table[options.sort]) {
    const column = table[options.sort];
    result =
      options.sortDirection === "desc" ? result.orderBy(desc(column)) : result.orderBy(asc(column));
  }

  return result as T;
}
