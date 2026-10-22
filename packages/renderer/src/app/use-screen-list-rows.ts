import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DispatcherError } from "../headless/index.ts";
import type { ListAggregates } from "../hooks/use-list-aggregates.ts";
import type { ListUrlStateApi } from "../hooks/use-list-url-state.ts";
import { useQuery } from "../hooks/use-query.ts";
import type { DataTableProps } from "../primitives.tsx";
import { refetchAfterWrite } from "./row-actions.ts";
import { type PagedRows, pageSizeOptionsFor } from "./screen-shared.tsx";

type Row = Readonly<Record<string, unknown>>;

type InfiniteState = {
  readonly resetKey: string;
  readonly rows: readonly Row[];
  readonly cursor: string | undefined;
  readonly hasMore: boolean;
};

function freshInfiniteState(resetKey: string): InfiniteState {
  return { resetKey, rows: [], cursor: undefined, hasMore: true };
}

// Live updates can bring an entry onto the next page that was already appended.
function appendUnseen(previous: readonly Row[], next: readonly Row[]): readonly Row[] {
  const seen = new Set<unknown>(previous.map((row) => row["id"]));
  return [...previous, ...next.filter((row) => !seen.has(row["id"]))];
}

export type ScreenListRows = {
  readonly rows: readonly Row[];
  /** The ungrouped page answer; null while grouped or before the first answer. */
  readonly page: PagedRows | null;
  readonly firstLoad: boolean;
  readonly error: DispatcherError | null;
  readonly hasData: boolean;
  readonly retry: () => Promise<void>;
  readonly infinite?: {
    readonly onReachEnd: () => void;
    readonly loadingMore: boolean;
    readonly hasMore: boolean;
  };
  readonly refreshAfterWrite: () => Promise<void>;
};

/** Rows of a URL-backed list screen: one page, accumulated infinite pages, or the
 *  loaded rows of the open server groups. `payload` carries no cursor. */
export function useScreenListRows({
  queryType,
  payload,
  infinite,
  aggregates,
}: {
  readonly queryType: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly infinite: boolean;
  readonly aggregates: ListAggregates;
}): ScreenListRows {
  const { grouped, refresh: refreshAggregates } = aggregates;
  const resetKey = JSON.stringify(payload);
  const [infiniteState, setInfiniteState] = useState(() => freshInfiniteState(resetKey));
  const state = infiniteState.resetKey === resetKey ? infiniteState : freshInfiniteState(resetKey);
  if (infiniteState.resetKey !== resetKey) setInfiniteState(state);
  const cursor = infinite ? state.cursor : undefined;

  const rowsPayload = useMemo(
    () => (cursor === undefined ? payload : { ...payload, cursor }),
    [payload, cursor],
  );
  const rowsQuery = useQuery<PagedRows>(queryType, rowsPayload, { live: true, enabled: !grouped });
  const { data, loading, refetch } = rowsQuery;

  const lastDataRef = useRef<PagedRows | null>(null);
  useEffect(() => {
    // skip: only a new answer of an infinite list is appended
    if (!infinite || data === null || data === lastDataRef.current) return;
    lastDataRef.current = data;
    setInfiniteState((current) =>
      current.resetKey !== resetKey
        ? current
        : {
            ...current,
            rows: current.cursor === undefined ? data.rows : appendUnseen(current.rows, data.rows),
            hasMore: data.nextCursor !== null,
          },
    );
  }, [data, infinite, resetKey]);

  const onReachEnd = useCallback(() => {
    // skip: the next page waits for the current answer
    if (loading) return;
    const nextCursor = data?.nextCursor;
    // skip: no cursor means the last page is loaded
    if (nextCursor === undefined || nextCursor === null) return;
    setInfiniteState((current) =>
      current.resetKey === resetKey ? { ...current, cursor: nextCursor } : current,
    );
  }, [loading, data, resetKey]);

  const refreshAfterWrite = useCallback(async () => {
    refreshAggregates();
    // skip: grouped rows reload through the aggregates refresh
    if (grouped) return;
    if (infinite && cursor !== undefined) {
      setInfiniteState(freshInfiniteState(resetKey));
      // skip: starting over refetches the first page
      return;
    }
    await refetchAfterWrite(refetch);
  }, [refreshAggregates, grouped, infinite, cursor, resetKey, refetch]);

  const retry = useCallback(async () => {
    if (grouped) refreshAggregates();
    else await refetch();
  }, [grouped, refreshAggregates, refetch]);

  if (grouped) {
    return {
      rows: aggregates.rows,
      page: null,
      firstLoad: aggregates.loading,
      error: aggregates.error,
      hasData: aggregates.serverGroups !== undefined,
      retry,
      refreshAfterWrite,
    };
  }
  return {
    rows: infinite ? state.rows : (data?.rows ?? []),
    page: data,
    firstLoad: loading && data === null,
    error: rowsQuery.error,
    hasData: data !== null,
    retry,
    ...(infinite && { infinite: { onReachEnd, loadingMore: loading, hasMore: state.hasMore } }),
    refreshAfterWrite,
  };
}

/** Pager props for `pagination: "pages"`; none until the server total arrives. */
export function listPager(args: {
  readonly usePager: boolean;
  readonly page: PagedRows | null;
  readonly limit: number;
  readonly urlState: Pick<ListUrlStateApi, "page" | "setPage" | "setPageSize">;
}): DataTableProps["pager"] {
  const { usePager, page, limit, urlState } = args;
  const total = page?.total;
  if (!usePager || total === undefined) return undefined;
  return {
    page: urlState.page,
    limit,
    total,
    onPageChange: urlState.setPage,
    pageSizeOptions: pageSizeOptionsFor(limit),
    onPageSizeChange: urlState.setPageSize,
  };
}
