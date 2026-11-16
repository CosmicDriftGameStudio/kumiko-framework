import type { ListRowDecoration } from "@cosmicdrift/kumiko-framework/ui-types";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDispatcher } from "../context/dispatcher-context.tsx";
import type { Dispatcher, DispatcherError } from "../headless/index.ts";
import {
  appendUnseenRows,
  mergeFreshFirstPage,
  type RowIdOf,
  rowIdSet,
} from "../hooks/infinite-rows.ts";
import type { ListAggregates } from "../hooks/use-list-aggregates.ts";
import type { ListUrlStateApi } from "../hooks/use-list-url-state.ts";
import { useQuery } from "../hooks/use-query.ts";
import type { DataTableProps } from "../primitives.tsx";
import { refetchAfterWrite } from "./row-actions.ts";
import { type PagedRows, pageSizeOptionsFor } from "./screen-shared.tsx";
import { useRowDecoration } from "./use-row-decoration.ts";

type Row = Readonly<Record<string, unknown>>;

const NO_ROWS: readonly Row[] = [];

type InfiniteState = {
  readonly resetKey: string;
  readonly rows: readonly Row[];
  readonly firstPageIds: ReadonlySet<unknown>;
  readonly laterPagesLoaded: boolean;
  readonly nextCursor: string | null;
  readonly loadingMore: boolean;
  readonly loadMoreError: DispatcherError | null;
};

function freshInfiniteState(resetKey: string): InfiniteState {
  return {
    resetKey,
    rows: [],
    firstPageIds: new Set(),
    laterPagesLoaded: false,
    nextCursor: null,
    loadingMore: false,
    loadMoreError: null,
  };
}

const rowIdOfListRow: RowIdOf<Row> = (row) => row["id"];

type ReloadedPages =
  | {
      readonly ok: true;
      readonly rows: readonly Row[];
      readonly firstPageIds: ReadonlySet<unknown>;
      readonly nextCursor: string | null;
      readonly laterPagesLoaded: boolean;
    }
  | { readonly ok: false; readonly error: DispatcherError };

async function reloadLoadedInfinitePages(args: {
  readonly dispatcher: Dispatcher;
  readonly queryType: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly targetRowCount: number;
}): Promise<ReloadedPages> {
  const { dispatcher, queryType, payload, targetRowCount } = args;
  const first = await dispatcher.query<PagedRows>(queryType, payload);
  if (!first.isSuccess) return { ok: false, error: first.error };
  const firstPageIds = rowIdSet(first.data.rows, rowIdOfListRow);
  let rows: readonly Row[] = first.data.rows;
  let nextCursor = first.data.nextCursor;
  let laterPagesLoaded = false;
  while (nextCursor !== null && rows.length < targetRowCount) {
    const page = await dispatcher.query<PagedRows>(queryType, { ...payload, cursor: nextCursor });
    if (!page.isSuccess) return { ok: false, error: page.error };
    rows = appendUnseenRows(rows, page.data.rows, rowIdOfListRow);
    nextCursor = page.data.nextCursor;
    laterPagesLoaded = true;
  }
  return { ok: true, rows, firstPageIds, nextCursor, laterPagesLoaded };
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
  rowDecoration,
  restoring = false,
}: {
  readonly queryType: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly infinite: boolean;
  readonly aggregates: ListAggregates;
  readonly rowDecoration?: ListRowDecoration | undefined;
  readonly restoring?: boolean;
}): ScreenListRows {
  const { grouped, refresh: refreshAggregates } = aggregates;
  const dispatcher = useDispatcher();
  const resetKey = JSON.stringify(payload);
  const [infiniteState, setInfiniteState] = useState(() => freshInfiniteState(resetKey));
  const state = infiniteState.resetKey === resetKey ? infiniteState : freshInfiniteState(resetKey);
  if (infiniteState.resetKey !== resetKey) setInfiniteState(state);
  const infiniteStateRef = useRef(state);
  infiniteStateRef.current = state;
  const loadMoreInFlight = useRef(false);

  const rowsQuery = useQuery<PagedRows>(queryType, payload, {
    live: true,
    enabled: !grouped && !restoring,
  });
  const { data, loading, refetch } = rowsQuery;

  const lastDataRef = useRef<PagedRows | null>(null);
  useEffect(() => {
    // skip: only a new first-page answer of an infinite list is merged
    if (!infinite || data === null || data === lastDataRef.current) return;
    lastDataRef.current = data;
    setInfiniteState((current) => {
      if (current.resetKey !== resetKey) return current;
      if (!current.laterPagesLoaded) {
        return {
          ...current,
          rows: data.rows,
          firstPageIds: rowIdSet(data.rows, rowIdOfListRow),
          nextCursor: data.nextCursor,
        };
      }
      return {
        ...current,
        rows: mergeFreshFirstPage({
          loadedRows: current.rows,
          previousFirstPageIds: current.firstPageIds,
          freshFirstPage: data.rows,
          rowIdOf: rowIdOfListRow,
        }),
        firstPageIds: rowIdSet(data.rows, rowIdOfListRow),
      };
    });
  }, [data, infinite, resetKey]);

  const onReachEnd = useCallback(() => {
    const cursor = state.nextCursor;
    // skip: a page is already loading or the last page is loaded
    if (!infinite || loadMoreInFlight.current || cursor === null) return;
    loadMoreInFlight.current = true;
    const requestKey = resetKey;
    setInfiniteState((current) =>
      current.resetKey === requestKey
        ? { ...current, loadingMore: true, loadMoreError: null }
        : current,
    );
    void dispatcher
      .query<PagedRows>(queryType, { ...payload, cursor })
      .then((result) => {
        setInfiniteState((c) => {
          if (c.resetKey !== requestKey) return c;
          if (!result.isSuccess) return { ...c, loadingMore: false, loadMoreError: result.error };
          return {
            ...c,
            rows: appendUnseenRows(c.rows, result.data.rows, rowIdOfListRow),
            nextCursor: result.data.nextCursor,
            laterPagesLoaded: true,
            loadingMore: false,
          };
        });
      })
      .finally(() => {
        loadMoreInFlight.current = false;
      });
  }, [infinite, state.nextCursor, resetKey, dispatcher, queryType, payload]);

  const refreshAfterWrite = useCallback(async () => {
    refreshAggregates();
    // skip: grouped rows reload through the aggregates refresh
    if (grouped) return;
    if (infinite && infiniteStateRef.current.laterPagesLoaded && !loadMoreInFlight.current) {
      loadMoreInFlight.current = true;
      const requestKey = resetKey;
      try {
        const reloaded = await reloadLoadedInfinitePages({
          dispatcher,
          queryType,
          payload,
          targetRowCount: infiniteStateRef.current.rows.length,
        });
        setInfiniteState((current) => {
          if (current.resetKey !== requestKey) return current;
          if (!reloaded.ok) return { ...current, loadMoreError: reloaded.error };
          return {
            ...current,
            rows: reloaded.rows,
            firstPageIds: reloaded.firstPageIds,
            nextCursor: reloaded.nextCursor,
            laterPagesLoaded: reloaded.laterPagesLoaded,
            loadMoreError: null,
          };
        });
      } finally {
        loadMoreInFlight.current = false;
      }
      return;
    }
    await refetchAfterWrite(refetch);
  }, [refreshAggregates, grouped, infinite, resetKey, dispatcher, queryType, payload, refetch]);

  const retry = useCallback(async () => {
    if (grouped) {
      refreshAggregates();
      return;
    }
    setInfiniteState((current) =>
      current.resetKey === resetKey ? { ...current, loadMoreError: null } : current,
    );
    await refetch();
  }, [grouped, refreshAggregates, resetKey, refetch]);

  const loadedRows = grouped ? aggregates.rows : infinite ? state.rows : (data?.rows ?? NO_ROWS);
  // Grouped rows are rebuilt on every render, so only a group refresh counts as a new answer.
  const answerToken = grouped ? aggregates.groupPages.refreshNonce : loadedRows;
  const rows = useRowDecoration(rowDecoration, loadedRows, answerToken, resetKey);

  if (grouped) {
    return {
      rows,
      page: null,
      firstLoad: aggregates.loading,
      error: aggregates.error,
      hasData: aggregates.serverGroups !== undefined,
      retry,
      refreshAfterWrite,
    };
  }
  return {
    rows,
    page: data,
    firstLoad: restoring || (loading && data === null),
    error: rowsQuery.error ?? (infinite ? state.loadMoreError : null),
    hasData: data !== null,
    retry,
    ...(infinite && {
      infinite: {
        onReachEnd,
        loadingMore: state.loadingMore,
        hasMore: state.nextCursor !== null,
      },
    }),
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
