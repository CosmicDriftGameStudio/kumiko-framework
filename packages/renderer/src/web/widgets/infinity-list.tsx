import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { DispatcherError } from "../../headless/index.ts";
import { subscribeToEntities, useLiveEntitiesForQuery } from "../../hooks/live-query-entities.ts";
import { useDispatcher, useLiveEvents, useTranslation } from "../../index.ts";
import { EmptyState, ErrorState, LoadingState } from "./states.tsx";

/** Position of the selected row among the rows loaded so far. `total`
 *  counts loaded rows only; `hasMore` says whether further pages exist. */
export type InfinityListSelection = {
  readonly index: number;
  readonly total: number;
  readonly prevId: string | null;
  readonly nextId: string | null;
  readonly hasMore: boolean;
};

export type InfinityListProps<TData = unknown, TRow = Readonly<Record<string, unknown>>> = {
  /** Dispatcher-Query-Type (`<feature>:query:<entity>:<verb>`). */
  readonly query: string;
  readonly payload?: Readonly<Record<string, unknown>>;
  /** Rows per page — sent as `limit` in the query payload. Default 50. */
  readonly pageSize?: number;
  readonly rows: (data: TData) => readonly TRow[];
  /** Pull the next-page cursor from the result; `null` means last page. */
  readonly nextCursor: (data: TData) => string | null;
  /** Must derive from row content (e.g. `row.id`), not from `index` — a
   *  live refresh reorders rows (new/changed rows move to the front). */
  readonly rowId: (row: TRow, index: number) => string;
  readonly renderRow: (row: TRow) => ReactNode;
  readonly emptyState?: ReactNode;
  readonly className?: string;
  readonly testId?: string;
  /** Subscribe to SSE events for the entity parsed from `query`
   *  (`<feature>:query:<entity>:<verb>`) and refetch the first page on
   *  any create/update/delete/restore event, merging it into the
   *  already-accumulated rows instead of collapsing them — see
   *  `useQuery`'s `live` option for the same convention. Default false. */
  readonly live?: boolean;
  /** Row id (as returned by `rowId`) whose position `onSelectionChange`
   *  reports. The list itself does not highlight it — `renderRow` does. */
  readonly selectedId?: string | null;
  /** Fires when the selected row's position or neighbours change, e.g. for
   *  a "message 4 of 6" header with previous/next buttons. Not called while
   *  nothing is selected or the selected row is not loaded. */
  readonly onSelectionChange?: (selection: InfinityListSelection) => void;
};

type State<TRow> =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly error: DispatcherError }
  | { readonly kind: "ready"; readonly rows: readonly TRow[]; readonly cursor: string | null };

/** Cursor-paginated scroll list (mail inbox, activity feeds) — loads the
 *  next page when the end sentinel becomes visible (IntersectionObserver),
 *  instead of a pager bar like QueryTable/entityList. The query handler
 *  receives `{ ...payload, limit, cursor? }` and returns rows plus the next
 *  cursor (same cursor convention as the audit-log screen). */
export function InfinityList<TData = unknown, TRow = Readonly<Record<string, unknown>>>({
  query,
  payload,
  pageSize = 50,
  rows,
  nextCursor,
  rowId,
  renderRow,
  emptyState,
  className,
  testId,
  live = false,
  selectedId,
  onSelectionChange,
}: InfinityListProps<TData, TRow>): ReactNode {
  const dispatcher = useDispatcher();
  const t = useTranslation();
  const subscribeLive = useLiveEvents();
  const liveEntities = useLiveEntitiesForQuery(query);
  const [state, setState] = useState<State<TRow>>({ kind: "loading" });
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const payloadKey = JSON.stringify(payload ?? {});

  // rows/nextCursor/rowId are fresh closures on every caller render
  // (inline arrow props). As useCallback deps that would recreate
  // `load`/`refreshFirstPage` every render → the effects below would
  // refetch in a loop. Refs keep them stable while always reading the
  // current selector.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const nextCursorRef = useRef(nextCursor);
  nextCursorRef.current = nextCursor;
  const rowIdRef = useRef(rowId);
  rowIdRef.current = rowId;

  // Discards a response whose request was superseded by a newer one before
  // it resolved (e.g. two searches fired in quick succession) — without
  // this, a slow earlier response can land after a faster later one and
  // overwrite it, leaving stale rows on screen.
  const requestSeq = useRef(0);

  // Lets refreshFirstPage tell "initial load still running" from outside a state updater.
  const stateKindRef = useRef(state.kind);
  stateKindRef.current = state.kind;

  // IDs of the most recently loaded first page. refreshFirstPage() needs
  // this to tell "row dropped from page 1 elsewhere" (must be pruned) apart
  // from "row belongs to an already-accumulated later page" (must survive)
  // — both are simply absent from the fresh page's id set.
  const firstPageIdsRef = useRef<ReadonlySet<string>>(new Set());

  // biome-ignore lint/correctness/useExhaustiveDependencies: payload goes through payloadKey
  const load = useCallback(
    async (cursor: string | null): Promise<void> => {
      const mySeq = ++requestSeq.current;
      const res = await dispatcher.query<TData>(query, {
        ...payload,
        limit: pageSize,
        ...(cursor !== null && { cursor }),
      });
      if (mySeq !== requestSeq.current) return;
      if (!res.isSuccess) {
        setState({ kind: "error", error: res.error });
        return;
      }
      const nextRows = rowsRef.current(res.data);
      if (cursor === null) {
        // Same identity as refreshFirstPage's freshIds/staleRows diff below
        // — this ref is what that diff's previousFirstPageIds reads, so it
        firstPageIdsRef.current = new Set(
          nextRows.map((row, index) => rowIdRef.current(row, index)),
        );
      }
      setState((prev) => {
        if (cursor === null || prev.kind !== "ready") {
          return { kind: "ready", rows: nextRows, cursor: nextCursorRef.current(res.data) };
        }
        // The live-merge above can re-sort a row to the front of page 1; an
        // offset-based cursor then re-serves that same row in a later page.
        // Dedupe on append so it doesn't land twice under duplicate React
        // keys.
        const existingIds = new Set(prev.rows.map((row, index) => rowIdRef.current(row, index)));
        const newRows = nextRows.filter(
          (row, index) => !existingIds.has(rowIdRef.current(row, index)),
        );
        return {
          kind: "ready",
          rows: [...prev.rows, ...newRows],
          cursor: nextCursorRef.current(res.data),
        };
      });
    },
    [dispatcher, query, pageSize, payloadKey],
  );

  useEffect(() => {
    setState({ kind: "loading" });
    void load(null);
    return () => {
      requestSeq.current += 1;
    };
  }, [load]);

  // Trailing debounce + in-flight coalesce: bulk SSE storms must not fan out
  // into one query per event. A refresh already running schedules
  // exactly one trailing pass after it settles.
  const liveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveInFlightRef = useRef(false);
  const liveTrailingRef = useRef(false);

  // Live-mode: on an SSE event for the query's entity, refetch only the
  // first page and merge it in — rows the fresh page still contains move
  // to the front (newest-first feeds), rows it dropped (edited/deleted
  // elsewhere) are pruned, and everything beyond page 1 stays untouched.
  // A full reload would collapse already-accumulated pages and jump the
  // scroll position.
  // biome-ignore lint/correctness/useExhaustiveDependencies: payload goes through payloadKey
  const refreshFirstPage = useCallback(async (): Promise<void> => {
    // Read, don't bump at the start: a concurrent load() (e.g. the mount
    // fetch still in flight) must not be discarded by a refresh that then
    // fails or is superseded. Only a refresh that actually delivers fresh
    // rows bumps (below), because those are newer than the running load's.
    const seqAtStart = requestSeq.current;
    const res = await dispatcher.query<TData>(query, { ...payload, limit: pageSize });
    if (seqAtStart !== requestSeq.current) {
      // A load-more bumps the sequence without covering page 1, so the signal that
      // triggered this refresh would otherwise be lost.
      liveTrailingRef.current = true;
      return;
    }
    // skip: background live refresh failed, keep showing the current rows
    if (!res.isSuccess) return;
    const freshRows = rowsRef.current(res.data);
    const freshIds = new Set(freshRows.map((row, index) => rowIdRef.current(row, index)));
    if (stateKindRef.current === "loading") {
      // The initial load was issued before the change that triggered this
      // refresh (the live stream reports its first open as a resync), so
      // its page 1 may be stale: adopt the fresh page and drop the older load.
      requestSeq.current += 1;
      firstPageIdsRef.current = freshIds;
      setState({ kind: "ready", rows: freshRows, cursor: nextCursorRef.current(res.data) });
      return;
    }
    // A row absent from freshIds is stale for one of two reasons: it was
    // dropped from page 1 (deleted, or filtered out elsewhere) and must be
    // pruned, or it belongs to an already-accumulated later page and must
    // survive. previousFirstPageIds — captured before it's overwritten below
    // — is what tells those two cases apart.
    const previousFirstPageIds = firstPageIdsRef.current;
    firstPageIdsRef.current = freshIds;
    setState((prev) => {
      if (prev.kind === "loading") return prev;
      if (prev.kind !== "ready") {
        // prev.kind === "error": this refresh succeeded — promote straight
        // to "ready" instead of leaving the list stuck on the earlier
        // failure forever (a live event should be able to recover it).
        return { kind: "ready", rows: freshRows, cursor: nextCursorRef.current(res.data) };
      }
      const staleRows = prev.rows.filter((row, index) => {
        const id = rowIdRef.current(row, index);
        return !freshIds.has(id) && !previousFirstPageIds.has(id);
      });
      return { kind: "ready", rows: [...freshRows, ...staleRows], cursor: prev.cursor };
    });
  }, [dispatcher, query, pageSize, payloadKey]);

  useEffect(() => {
    // skip: live mode off, no SSE subscription needed
    if (!live) return;
    // skip: no entity to listen on, nothing to subscribe to
    if (liveEntities.length === 0) return;

    const runRefresh = (): void => {
      liveInFlightRef.current = true;
      void refreshFirstPage().finally(() => {
        liveInFlightRef.current = false;
        if (liveTrailingRef.current) {
          liveTrailingRef.current = false;
          runRefresh();
        }
      });
    };

    const scheduleRefresh = (): void => {
      if (liveTimerRef.current !== null) clearTimeout(liveTimerRef.current);
      liveTimerRef.current = setTimeout(() => {
        liveTimerRef.current = null;
        if (liveInFlightRef.current) {
          liveTrailingRef.current = true;
          return;
        }
        runRefresh();
      }, 250);
    };

    const unsubscribe = subscribeToEntities(subscribeLive, liveEntities, scheduleRefresh);
    return () => {
      unsubscribe();
      if (liveTimerRef.current !== null) {
        clearTimeout(liveTimerRef.current);
        liveTimerRef.current = null;
      }
    };
  }, [live, liveEntities, refreshFirstPage, subscribeLive]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    // skip: no further page or not ready yet — observer not needed
    if (sentinel === null || state.kind !== "ready" || state.cursor === null) return;
    const cursor = state.cursor;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting === true) void load(cursor);
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [state, load]);

  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  useEffect(() => {
    if (selectedId === undefined || selectedId === null || state.kind !== "ready") return;
    const ids = state.rows.map((row, index) => rowIdRef.current(row, index));
    const index = ids.indexOf(selectedId);
    if (index === -1) return;
    onSelectionChangeRef.current?.({
      index,
      total: ids.length,
      prevId: ids[index - 1] ?? null,
      nextId: ids[index + 1] ?? null,
      hasMore: state.cursor !== null,
    });
  }, [state, selectedId]);

  if (state.kind === "loading") return <LoadingState rows={4} testId={testId} />;
  if (state.kind === "error")
    return <ErrorState error={state.error} onRetry={() => void load(null)} testId={testId} />;
  if (state.rows.length === 0)
    return <>{emptyState ?? <EmptyState title={t("kumiko.list.no-entries")} testId={testId} />}</>;

  return (
    <div data-testid={testId} className={className ?? "flex flex-col overflow-y-auto"}>
      {state.rows.map((row, index) => (
        <div key={rowId(row, index)}>{renderRow(row)}</div>
      ))}
      <div ref={sentinelRef} className="h-px" />
    </div>
  );
}
