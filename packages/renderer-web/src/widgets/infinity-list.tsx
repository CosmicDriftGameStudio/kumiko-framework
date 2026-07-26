import type { DispatcherError } from "@cosmicdrift/kumiko-headless";
import { useDispatcher, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "./states";

export type InfinityListProps<TData = unknown, TRow = Readonly<Record<string, unknown>>> = {
  /** Dispatcher-Query-Type (`<feature>:query:<entity>:<verb>`). */
  readonly query: string;
  readonly payload?: Readonly<Record<string, unknown>>;
  /** Rows pro Seite, geht als `limit` ins Query-Payload. Default 50. */
  readonly pageSize?: number;
  readonly rows: (data: TData) => readonly TRow[];
  /** Cursor für die nächste Seite aus dem Result ziehen; `null` = letzte Seite. */
  readonly nextCursor: (data: TData) => string | null;
  readonly rowId: (row: TRow, index: number) => string;
  readonly renderRow: (row: TRow) => ReactNode;
  readonly emptyState?: ReactNode;
  readonly className?: string;
  readonly testId?: string;
};

type State<TRow> =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly error: DispatcherError }
  | { readonly kind: "ready"; readonly rows: readonly TRow[]; readonly cursor: string | null };

/** Cursor-paginierte Scroll-Liste (Mail-Inbox, Activity-Feeds) — lädt die
 *  nächste Seite automatisch nach, sobald der Sentinel am Ende sichtbar wird
 *  (IntersectionObserver), statt einer Pager-Leiste wie bei QueryTable/
 *  entityList. Query-Handler bekommt `{ ...payload, limit, cursor? }` und
 *  liefert Rows + nächsten Cursor (gleiche Cursor-Convention wie der
 *  audit-log-screen). */
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
}: InfinityListProps<TData, TRow>): ReactNode {
  const dispatcher = useDispatcher();
  const t = useTranslation();
  const [state, setState] = useState<State<TRow>>({ kind: "loading" });
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const payloadKey = JSON.stringify(payload ?? {});

  // rows/nextCursor sind bei jedem Caller-Render neue Closures (Inline-
  // Arrow-Props). Als useCallback-Deps würde `load` bei jedem Render neu
  // entstehen → der Mount-Effect unten refetcht in einer Schleife. Refs
  // umgehen das: `load` bleibt stabil, liest aber immer die aktuelle
  // Selector-Funktion.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const nextCursorRef = useRef(nextCursor);
  nextCursorRef.current = nextCursor;

  // biome-ignore lint/correctness/useExhaustiveDependencies: payload goes through payloadKey
  const load = useCallback(
    async (cursor: string | null): Promise<void> => {
      const res = await dispatcher.query<TData>(query, {
        ...payload,
        limit: pageSize,
        ...(cursor !== null && { cursor }),
      });
      if (!res.isSuccess) {
        setState({ kind: "error", error: res.error });
        return;
      }
      const nextRows = rowsRef.current(res.data);
      setState((prev) => ({
        kind: "ready",
        rows: cursor === null || prev.kind !== "ready" ? nextRows : [...prev.rows, ...nextRows],
        cursor: nextCursorRef.current(res.data),
      }));
    },
    [dispatcher, query, pageSize, payloadKey],
  );

  useEffect(() => {
    setState({ kind: "loading" });
    void load(null);
  }, [load]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    // skip: keine weitere Seite oder noch nicht bereit — kein Observer nötig
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
