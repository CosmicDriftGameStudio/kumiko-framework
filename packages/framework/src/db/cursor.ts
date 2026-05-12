import type { EntityId, TenantId } from "../engine/types/identifiers";
import { and, asc, desc, eq, gt, inArray, type SQL, sql } from "drizzle-orm";
import type { SelectQuery as PgSelect } from "./dialect";

export type CursorQueryOptions = {
  tenantId: TenantId;
  cursor?: string;
  limit?: number;
  filterIds?: readonly EntityId[];
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

// String-basiert damit sowohl UUIDs (Default seit Sprint F) als auch
// Integer-Auto-Increment-IDs (Legacy/Spezialfälle) durch denselben
// Cursor-Pfad laufen. Stable-Sort-Voraussetzung: die id-Spalte muss
// lexikografisch monoton zur Insertion-Order sein. UUIDv7 erfüllt das
// (time-ordered Prefix); UUIDv4 nicht — wer den nutzt, kriegt
// inkorrekte cursor-Reihenfolge, das ist erwartet (Default ist v7).
export function encodeCursor(id: string | number): string {
  return Buffer.from(String(id)).toString("base64url");
}

export function decodeCursor(cursor: string): string {
  const decoded = Buffer.from(cursor, "base64url").toString();
  if (decoded === "") throw new Error(`Invalid cursor: ${cursor}`);
  return decoded;
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
      // No matching IDs — return empty result via raw `false`. Statisch
      // false ist type-agnostisch (int-PK / uuid-PK egal); ein eq(id, "")
      // oder eq(id, -1) würde je nach Spalten-Type einen Cast-Error
      // werfen.
      conditions.push(sql`false`);
    } else {
      conditions.push(inArray(table.id, options.filterIds as readonly string[])); // @cast-boundary db-operator
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

  return result as T; // @cast-boundary engine-bridge
}
