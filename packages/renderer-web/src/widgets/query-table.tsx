import type { ListRowViewModel } from "@cosmicdrift/kumiko-headless";
import {
  type DataTableProps,
  useQuery,
  usePrimitives,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { EmptyState, ErrorState, LoadingState } from "./states";

// Query-backed Tabelle für Custom-Screens: ein Widget statt der
// handgebauten useState+fetch+<table>-Trios. Deklarativ: Query-Type +
// Spalten rein, Loading/Error/Empty/Render übernimmt das Widget über
// das DataTable-Primitive (gleiche Optik wie entityList-Screens).
//
// ponytail: Zellen rendern über die DataTable-Typ-Formatierung (text/
// number/money/…), kein render-Prop pro Spalte — für Custom-Zellen die
// entityList-columnRenderers nutzen oder das Widget erweitern, wenn eine
// Migration es wirklich braucht.

export type QueryTableColumn = {
  readonly field: string;
  /** Translated Header-Label (i18n-Key auflösen liegt beim Caller). */
  readonly label: string;
  /** Field-Type für die Zell-Formatierung. Default "text". */
  readonly type?: string;
};

export type QueryTableProps<TData = unknown> = {
  /** Dispatcher-Query-Type (`<feature>:query:<entity>:<verb>`). */
  readonly query: string;
  readonly payload?: unknown;
  /** SSE-Invalidierung — refetcht bei Entity-Events (useQuery live-mode). */
  readonly live?: boolean;
  readonly columns: readonly QueryTableColumn[];
  /** Rows aus dem Query-Result ziehen. Default: Result selbst als Array. */
  readonly rows?: (data: TData) => readonly Readonly<Record<string, unknown>>[];
  /** Row-Id für Keys/Row-Click. Default: `row.id`, sonst der Index. */
  readonly rowId?: (row: Readonly<Record<string, unknown>>, index: number) => string;
  readonly onRowClick?: DataTableProps["onRowClick"];
  readonly rowActions?: DataTableProps["rowActions"];
  /** Empty-Inhalt — Default ist der Standard-Empty-State der Listen. */
  readonly emptyState?: ReactNode;
  readonly toolbarTitle?: ReactNode;
  readonly toolbarEnd?: ReactNode;
  readonly testId?: string;
};

function defaultRows(data: unknown): readonly Readonly<Record<string, unknown>>[] {
  return Array.isArray(data) ? (data as readonly Readonly<Record<string, unknown>>[]) : [];
}

export function QueryTable<TData = unknown>({
  query,
  payload,
  live = false,
  columns,
  rows,
  rowId,
  onRowClick,
  rowActions,
  emptyState,
  toolbarTitle,
  toolbarEnd,
  testId,
}: QueryTableProps<TData>): ReactNode {
  const { DataTable } = usePrimitives();
  const t = useTranslation();
  const { data, error, loading, refetch } = useQuery<TData>(query, payload ?? {}, { live });

  if (loading && data === null) return <LoadingState rows={4} testId={testId} />;
  if (error !== null) return <ErrorState error={error} onRetry={() => void refetch()} testId={testId} />;

  const rawRows = rows !== undefined ? rows(data as TData) : defaultRows(data);
  const vmRows: readonly ListRowViewModel[] = rawRows.map((row, index) => ({
    id:
      rowId !== undefined
        ? rowId(row, index)
        : typeof row["id"] === "string"
          ? row["id"]
          : String(index),
    values: row,
  }));

  return (
    <DataTable
      columns={columns.map((c) => ({
        field: c.field,
        label: c.label,
        type: c.type ?? "text",
        sortable: false,
      }))}
      rows={vmRows}
      onRowClick={onRowClick}
      rowActions={rowActions}
      emptyState={emptyState ?? <EmptyState title={t("kumiko.list.no-entries")} />}
      toolbarTitle={toolbarTitle}
      toolbarEnd={toolbarEnd}
      testId={testId}
    />
  );
}
