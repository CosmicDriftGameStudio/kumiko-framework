import {
  declaredSortNulls,
  type EntityDefinition,
  instantSortKey,
  normalizeListColumn,
  nullsSortFirst,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { isMoneyValue } from "../app/entity-edit-prefill.ts";
import type { EditRelatedListSectionViewModel, Translate } from "../headless/index.ts";
import type { DataTableSort } from "../primitives.tsx";
import { sortByAccessor } from "../sort-by-accessor.ts";
import { type ListAggregates, useListAggregates } from "./use-list-aggregates.ts";
import { useQuery } from "./use-query.ts";

type Row = Readonly<Record<string, unknown>>;

type PagedRows = {
  readonly rows: Row[];
  readonly nextCursor: string | null;
  readonly total?: number;
};

const DEFAULT_GROUP_PAGE_SIZE = 50;

const CREATION_ORDER: DataTableSort = { field: "insertedAt", dir: "asc" };

/** The sort the section's query applies itself: the active one when the query
 *  orders by that column, else creation order where the query offers it, so
 *  rows with random (v4) ids do not come back shuffled. */
export function relatedListServerSort(
  section: EditRelatedListSectionViewModel,
  sort: DataTableSort | null,
): DataTableSort | undefined {
  const serverFields = section.serverSortFields ?? [];
  if (sort !== null && serverFields.includes(sort.field)) return sort;
  return serverFields.includes(CREATION_ORDER.field) ? CREATION_ORDER : undefined;
}

// Mirrors the server's column sort: money by its amount column alone, a
// locatedTimestamp by its instant, every other value as it is stored.
function relatedListSortValue(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (isMoneyValue(value)) return value.amount;
  const locatedUtc = propertyOf(value, "utc");
  const text = typeof locatedUtc === "string" ? locatedUtc : String(value);
  return instantSortKey(text) ?? text;
}

// The server list's tie order (`ORDER BY <field>, id ASC`); uuid order is its hex text order.
function compareRowIds(a: Row, b: Row): number {
  const aId = a["id"];
  const bId = b["id"];
  if (typeof aId !== "string" || typeof bId !== "string" || aId === bId) return 0;
  return aId < bId ? -1 : 1;
}

// A handler that omits `nextCursor` (or reports a `total` the fetched rows
// already cover) has no further rows; only a real cursor marks truncation.
function isTruncatedFetch(data: PagedRows | null): boolean {
  return (
    data !== null &&
    typeof data.nextCursor === "string" &&
    (data.total === undefined || data.total > data.rows.length)
  );
}

export type RelatedListRows = {
  readonly rows: readonly Row[];
  readonly firstLoad: boolean;
  readonly error: ListAggregates["error"];
  readonly hasData: boolean;
  /** The one-shot fetch stopped early; the section has no pager for the rest. */
  readonly truncated: boolean;
  readonly aggregates: ListAggregates;
  readonly refetchSelfAndHost: () => Promise<void>;
};

/** Rows of a relatedList section: one fetch in the query's order, sorted on the
 *  client only for a column the query cannot order by, or the loaded rows of its
 *  server groups in server order when `table.grouping` is active. */
export function useRelatedListRows(args: {
  readonly section: EditRelatedListSectionViewModel;
  /** Field definitions of the section's columns; a declared `sortNulls` places empty values. */
  readonly fields: EntityDefinition["fields"];
  readonly payload: Readonly<Record<string, unknown>>;
  readonly groupField: string | undefined;
  readonly sort: DataTableSort | null;
  readonly locale: string | undefined;
  readonly refreshToken: unknown;
  readonly onAfterWrite: (() => Promise<void> | void) | undefined;
  readonly translate: Translate;
}): RelatedListRows {
  const { section, fields, payload, groupField, sort, locale, refreshToken, onAfterWrite } = args;
  const aggregates = useListAggregates({
    queryType: section.query,
    payload,
    table: section.table,
    groupField,
    pageSize: section.pageSize ?? DEFAULT_GROUP_PAGE_SIZE,
    paging: "cursor",
    translate: args.translate,
  });
  const { grouped, refresh: refreshAggregates } = aggregates;
  const rowsQuery = useQuery<PagedRows>(section.query, payload, { enabled: !grouped });
  const ownRefetch = rowsQuery.refetch;
  const refetchOwn = useCallback(async () => {
    refreshAggregates();
    if (!grouped) await ownRefetch();
  }, [refreshAggregates, grouped, ownRefetch]);

  const lastRefreshTokenRef = useRef(refreshToken);
  useEffect(() => {
    // skip: the token has not changed since the last refetch
    if (lastRefreshTokenRef.current === refreshToken) return;
    lastRefreshTokenRef.current = refreshToken;
    void refetchOwn();
  }, [refreshToken, refetchOwn]);
  const refetchSelfAndHost = useCallback(async (): Promise<void> => {
    if (onAfterWrite === undefined) {
      await refetchOwn();
      return;
    }
    await onAfterWrite();
    // A host that passes a refreshToken changes it when it reloads, and that change
    // refetches the list; refetching here too would query it twice per write.
    if (refreshToken === undefined) await refetchOwn();
  }, [refetchOwn, onAfterWrite, refreshToken]);

  const sortAccessors = useMemo(() => {
    const accessors: Record<string, (row: Row) => string | number | null> = {};
    for (const col of section.columns) {
      const field = normalizeListColumn(col).field;
      accessors[field] = (row) => relatedListSortValue(row[field]);
    }
    return accessors;
  }, [section.columns]);
  // A column the query already ordered is not sorted again here: two rules for one order drift.
  const clientSort =
    sort !== null &&
    section.serverSortFields?.includes(sort.field) !== true &&
    propertyOf(fields[sort.field], "sortable") === true
      ? sort
      : null;
  const sortedRows = useMemo(
    () =>
      sortByAccessor(rowsQuery.data?.rows ?? [], clientSort, sortAccessors, locale, {
        nullsFirst: (active) =>
          nullsSortFirst(active.dir === "desc", declaredSortNulls(fields[active.field])),
        tieBreaker: compareRowIds,
      }),
    [rowsQuery.data, clientSort, sortAccessors, locale, fields],
  );

  if (grouped) {
    return {
      rows: aggregates.rows,
      firstLoad: aggregates.loading,
      error: aggregates.error,
      hasData: aggregates.serverGroups !== undefined,
      truncated: false,
      aggregates,
      refetchSelfAndHost,
    };
  }
  return {
    rows: sortedRows,
    firstLoad: rowsQuery.loading && rowsQuery.data === null,
    error: rowsQuery.error,
    hasData: rowsQuery.data !== null,
    truncated: isTruncatedFetch(rowsQuery.data),
    aggregates,
    refetchSelfAndHost,
  };
}
