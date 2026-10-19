// Search, sort and offset paging for projectionList queries whose rows are
// assembled in memory (merged from several tables, no single SQL query to
// page). The projectionList pager sends `offset` + `totalCount`, never a
// cursor, so `nextCursor` is always null here.

import type { CursorResult } from "@cosmicdrift/kumiko-types/cursor-types";
import * as z from "zod";
import { MAX_LIST_LIMIT } from "./entity-handlers.ts";

export type PagedListRowValue = string | number | boolean | null;

export function pagedListSchema<const TSortField extends string>(
  sortableFields: readonly [TSortField, ...TSortField[]],
) {
  return z.object({
    limit: z.number().int().min(1).max(MAX_LIST_LIMIT).default(50),
    offset: z.number().int().nonnegative().optional(),
    search: z.string().optional(),
    sort: z.enum(sortableFields).optional(),
    sortDirection: z.enum(["asc", "desc"]).optional(),
    totalCount: z.boolean().optional(),
    // Declared so a caller still paging by cursor gets a 400 instead of page one.
    cursor: z.never({ error: "cursor paging is not supported here; page with offset" }).optional(),
  });
}

export type PagedListRequest<TSortField extends string> = {
  readonly limit: number;
  readonly offset?: number | undefined;
  readonly search?: string | undefined;
  readonly sort?: TSortField | undefined;
  readonly sortDirection?: "asc" | "desc" | undefined;
  readonly totalCount?: boolean | undefined;
};

function isMissing(value: PagedListRowValue | undefined): value is null | undefined {
  return value === null || value === undefined;
}

// Missing values sort last in both directions; numbers and booleans compare
// by value, everything else as a locale-aware string.
function compareRowValues(
  a: PagedListRowValue | undefined,
  b: PagedListRowValue | undefined,
  directionMultiplier: 1 | -1,
): number {
  if (isMissing(a) && isMissing(b)) return 0;
  if (isMissing(a)) return 1;
  if (isMissing(b)) return -1;
  if (typeof a === "number" && typeof b === "number") return (a - b) * directionMultiplier;
  if (typeof a === "boolean" && typeof b === "boolean") {
    return (Number(a) - Number(b)) * directionMultiplier;
  }
  return String(a).localeCompare(String(b)) * directionMultiplier;
}

export function pageRows<
  TRow extends Readonly<Record<TSortField, PagedListRowValue>> & { readonly id: string },
  TSortField extends string,
>(
  rows: readonly TRow[],
  request: PagedListRequest<TSortField>,
  options: {
    readonly searchFields: readonly TSortField[];
    readonly defaultSort: TSortField;
  },
): CursorResult<TRow> {
  const needle = request.search?.trim().toLowerCase() ?? "";
  const matching =
    needle === ""
      ? rows
      : rows.filter((row) =>
          options.searchFields.some((field) =>
            String(row[field] ?? "")
              .toLowerCase()
              .includes(needle),
          ),
        );
  const sortField = request.sort ?? options.defaultSort;
  const directionMultiplier = request.sortDirection === "desc" ? -1 : 1;
  // The source rows come unordered, so ties fall back to the id; otherwise a
  // tied row could show up on two pages or on none.
  const sorted = [...matching].sort(
    (a, b) =>
      compareRowValues(a[sortField], b[sortField], directionMultiplier) || a.id.localeCompare(b.id),
  );
  const offset = request.offset ?? 0;
  return {
    rows: sorted.slice(offset, offset + request.limit),
    nextCursor: null,
    ...(request.totalCount === true && { total: matching.length }),
  };
}
