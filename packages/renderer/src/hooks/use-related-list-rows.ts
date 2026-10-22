import { normalizeListColumn } from "@cosmicdrift/kumiko-framework/ui-types";
import { useCallback, useEffect, useMemo, useRef } from "react";
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
  /** The one-shot fetch stopped early, so the client-side sort covers part of the set. */
  readonly truncated: boolean;
  readonly aggregates: ListAggregates;
  readonly refetchSelfAndHost: () => Promise<void>;
};

/** Rows of a relatedList section: one fetch sorted on the client, or the loaded
 *  rows of its server groups in server order when `table.grouping` is active. */
export function useRelatedListRows(args: {
  readonly section: EditRelatedListSectionViewModel;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly groupField: string | undefined;
  readonly sort: DataTableSort | null;
  readonly locale: string | undefined;
  readonly refreshToken: unknown;
  readonly onAfterWrite: (() => Promise<void> | void) | undefined;
  readonly translate: Translate;
}): RelatedListRows {
  const { section, payload, groupField, sort, locale, refreshToken, onAfterWrite } = args;
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
    if (lastRefreshTokenRef.current === refreshToken) return;
    lastRefreshTokenRef.current = refreshToken;
    void refetchOwn();
  }, [refreshToken, refetchOwn]);
  const refetchSelfAndHost = useCallback(async (): Promise<void> => {
    await refetchOwn();
    await onAfterWrite?.();
  }, [refetchOwn, onAfterWrite]);

  const sortAccessors = useMemo(() => {
    const accessors: Record<string, (row: Row) => string | number | null> = {};
    for (const col of section.columns) {
      const field = normalizeListColumn(col).field;
      accessors[field] = (row) => {
        const value = row[field];
        if (value === null || value === undefined) return null;
        return typeof value === "number" ? value : String(value);
      };
    }
    return accessors;
  }, [section.columns]);
  const sortedRows = useMemo(
    () => sortByAccessor(rowsQuery.data?.rows ?? [], sort, sortAccessors, locale),
    [rowsQuery.data, sort, sortAccessors, locale],
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
