import { and, eq, gt, ilike, or, type SQL } from "drizzle-orm";
import type { PgSelect } from "drizzle-orm/pg-core";

export type CursorQueryOptions = {
  tenantId: number;
  cursor?: string;
  limit?: number;
  search?: string;
  searchColumns?: readonly string[];
  extraWhere?: SQL;
};

export type CursorResult<T> = {
  rows: T[];
  nextCursor: string | null;
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

  if (options.search && options.searchColumns && options.searchColumns.length > 0) {
    const searchConditions = options.searchColumns
      .map((col) => {
        const column = table[col];
        return column ? ilike(column, `%${options.search}%`) : undefined;
      })
      .filter((c): c is SQL => c !== undefined);

    if (searchConditions.length > 0) {
      const combined = or(...searchConditions);
      if (combined) conditions.push(combined);
    }
  }

  if (options.extraWhere) {
    conditions.push(options.extraWhere);
  }

  const limit = options.limit ?? 50;

  return query.where(and(...conditions)).limit(limit) as T;
}
