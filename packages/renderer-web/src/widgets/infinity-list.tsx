import type { DispatcherError } from "@cosmicdrift/kumiko-headless";
import {
  entityFromQueryType,
  useDispatcher,
  useLiveEvents,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "./states";

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
}: InfinityListProps<TData, TRow>): ReactNode {
  const dispatcher = useDispatcher();
  const t = useTranslation();
  const subscribeLive = useLiveEvents();
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
  // overwrite it, leaving stale rows on screen (fw#1705).
  const requestSeq = useRef(0);

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

  // Live-mode: on an SSE event for the query's entity, refetch only the
  // first page and merge it in — rows the fresh page still contains move
  // to the front (newest-first feeds), rows it dropped (edited/deleted
  // elsewhere) are pruned, and everything beyond page 1 stays untouched.
  // A full reload would collapse already-accumulated pages and jump the
  // scroll position; see fw#1827.
  // biome-ignore lint/correctness/useExhaustiveDependencies: payload goes through payloadKey
  const refreshFirstPage = useCallback(async (): Promise<void> => {
    // Read, don't bump: a concurrent load() (e.g. the mount fetch still
    // in flight) must still land. Bumping here would make load()'s own
    // sequence check discard it, and the refresh below then bails on
    // `prev.kind !== "ready"` — the list gets stuck in loading forever.
    const seqAtStart = requestSeq.current;
    const res = await dispatcher.query<TData>(query, { ...payload, limit: pageSize });
    if (seqAtStart !== requestSeq.current) return;
    // skip: background live refresh failed, keep showing the current rows
    if (!res.isSuccess) return;
    const freshRows = rowsRef.current(res.data);
    const freshIds = new Set(freshRows.map((row, index) => rowIdRef.current(row, index)));
    // A row absent from freshIds is stale for one of two reasons: it was
    // dropped from page 1 (deleted, or filtered out elsewhere) and must be
    // pruned, or it belongs to an already-accumulated later page and must
    // survive. previousFirstPageIds — captured before it's overwritten below
    // — is what tells those two cases apart.
    const previousFirstPageIds = firstPageIdsRef.current;
    firstPageIdsRef.current = freshIds;
    setState((prev) => {
      // skip: the initial load() is still in flight and owns the eventual
      // state — a concurrent refresh landing here has nothing accumulated
      // to merge into yet.
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

  // Trailing debounce + in-flight coalesce: bulk SSE storms must not fan out
  // into one query per event (fw#1829). A refresh already running schedules
  // exactly one trailing pass after it settles.
  const liveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveInFlightRef = useRef(false);
  const liveTrailingRef = useRef(false);

  useEffect(() => {
    // skip: live mode off, no SSE subscription needed
    if (!live) return;
    const entity = entityFromQueryType(query);
    // skip: query type has no mapped entity, nothing to subscribe to
    if (entity === undefined) return;

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

    const unsubscribe = subscribeLive(entity, scheduleRefresh);
    return () => {
      unsubscribe();
      if (liveTimerRef.current !== null) {
        clearTimeout(liveTimerRef.current);
        liveTimerRef.current = null;
      }
    };
  }, [live, query, refreshFirstPage, subscribeLive]);

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
