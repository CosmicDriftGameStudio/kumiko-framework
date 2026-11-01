import { UnprocessableError } from "../errors/index.ts";
import type { DbRunner } from "./connection.ts";
import { decodeKeysetCursor, encodeCursor, encodeKeysetCursor } from "./cursor.ts";
import type { Table } from "./event-store-executor-context.ts";
import type { ListWhere } from "./event-store-executor-read-filter.ts";
import { type ListSort, renderSortSql, sortsNullsFirst } from "./event-store-executor-read-sort.ts";
import { executeRawQueryRead } from "./queries/raw-sql.ts";
import { physicalColumnName } from "./table-builder.ts";

// Defense-in-depth pagination guard. The handler boundary (entityListSchema)
// already validates limit/offset, but the executor is public API for custom
// handlers that pass their payload straight through — a non-integer limit
// would otherwise be interpolated raw into `LIMIT ${limit}` SQL text.
const MAX_LIST_LIMIT = 200; // keep in sync with engine/entity-handlers.ts MAX_LIST_LIMIT

export const DEFAULT_LIST_LIMIT = 50;

export function resolveListPagination(payload: {
  readonly limit?: unknown;
  readonly offset?: unknown;
}): { readonly limit: number; readonly offset: number } {
  const limit = payload.limit ?? DEFAULT_LIST_LIMIT;
  const offset = payload.offset ?? 0;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 0) {
    throw new UnprocessableError("invalid_list_limit", {
      details: { hint: "limit must be a non-negative integer" },
    });
  }
  if (typeof offset !== "number" || !Number.isInteger(offset) || offset < 0) {
    throw new UnprocessableError("invalid_list_offset", {
      details: { hint: "offset must be a non-negative integer" },
    });
  }
  return { limit: Math.min(limit, MAX_LIST_LIMIT), offset };
}

// Cursor sort values travel as text and bind as plain string params — Postgres
// infers the parameter type from the column they are compared against, the same
// way prepareValue binds a timestamptz as an ISO string. undefined means the
// driver value has no faithful text form, which downgrades the page to the
// legacy id-only boundary instead of emitting a wrong one.
function toCursorSortText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const tag = Reflect.get(value, Symbol.toStringTag);
    if (typeof tag === "string" && tag.startsWith("Temporal.")) return String(value);
    return JSON.stringify(value);
  }
  return undefined;
}

// Keyset boundary for `ORDER BY <sort> <dir> [NULLS FIRST|LAST], id ASC`. Without a declared
// `sortNulls` Postgres' default applies (ASC → NULLS LAST, DESC → NULLS FIRST), which keeps the
// sort on a plain index; a declared one may need an index with the same NULLS order.
function keysetBoundarySql(
  sortCol: string,
  idCol: string,
  cursor: { readonly id: string; readonly sortValue: string | null },
  order: { readonly descending: boolean; readonly nullsComeFirst: boolean },
  params: unknown[],
): string {
  params.push(cursor.id);
  const afterId = `${idCol} > $${params.length}`;
  const { descending, nullsComeFirst } = order;
  if (cursor.sortValue === null) {
    return nullsComeFirst
      ? `(${sortCol} IS NOT NULL OR ${afterId})`
      : `(${sortCol} IS NULL AND ${afterId})`;
  }
  params.push(cursor.sortValue);
  const sortParam = `$${params.length}`;
  const beyond = `${sortCol} ${descending ? "<" : ">"} ${sortParam}`;
  const tie = `(${sortCol} = ${sortParam} AND ${afterId})`;
  return nullsComeFirst
    ? `(${sortCol} IS NOT NULL AND (${beyond} OR ${tie}))`
    : `(${sortCol} IS NULL OR ${beyond} OR ${tie})`;
}

export function appendCursorBoundary(
  where: ListWhere,
  encodedCursor: string,
  sort: ListSort,
): void {
  const cursor = decodeKeysetCursor(encodedCursor);
  if (sort.kind === "unsorted" || cursor.sortValue === undefined) {
    where.params.push(cursor.id);
    where.whereSql.push(`${where.colSql("id")} > $${where.params.length}`);
  } else {
    where.whereSql.push(
      keysetBoundarySql(
        renderSortSql(sort, where),
        where.colSql("id"),
        { id: cursor.id, sortValue: cursor.sortValue },
        { descending: sort.descending, nullsComeFirst: sortsNullsFirst(sort) },
        where.params,
      ),
    );
  }
}

export function encodeNextCursor(
  cursorId: string,
  sort: ListSort,
  lastRaw: Record<string, unknown>,
  lastSortLabel: unknown,
  table: Table,
): string {
  const sortText =
    sort.kind === "unsorted"
      ? undefined
      : toCursorSortText(
          sort.kind === "expression"
            ? lastSortLabel
            : lastRaw[physicalColumnName(table, sort.field)],
        );
  return sortText === undefined ? encodeCursor(cursorId) : encodeKeysetCursor(sortText, cursorId);
}

// total: extra COUNT(*) — only when explicitly requested (pager UI).
// Postgres cost is O(table-scan) without a filter, with a filter as
// expensive as the corresponding WHERE — cheap enough on indexed columns.
// Always counted over the full WHERE: search ids, reference matches, tenant,
// soft-delete, cursor, ownership and filters all narrow the result, so the
// search hit count alone is never the total.
export async function countListRows(
  runner: DbRunner,
  tableName: string,
  whereClauseSqlText: string,
  whereParams: readonly unknown[],
): Promise<number> {
  const countSql = `SELECT COUNT(*)::int AS count FROM "${tableName}"${whereClauseSqlText}`;
  const countRows = await executeRawQueryRead<{ count: number }>(runner, countSql, whereParams);
  return countRows[0]?.count ?? 0;
}
