import type { ReactNode } from "react";
import type { ListRowViewModel } from "../../headless/index.ts";
import { type DataTableProps, usePrimitives, useQuery, useTranslation } from "../../index.ts";
import { EmptyState, ErrorState, LoadingState } from "./states.tsx";

// Query-backed table for custom screens: a widget instead of hand-built
// useState+fetch+<table> trios. Declarative: provide the query type and
// columns; the widget handles loading, error, empty, and rendering through
// the DataTable primitive (with the same appearance as entityList screens).
//
// ponytail: Cells use DataTable type formatting (text/number/money/…), with
// no render prop per column — use entityList-columnRenderers for custom cells
// or extend the widget when a migration genuinely requires it.

export type QueryTableColumn = {
  readonly field: string;
  /** Translated header label (resolving the i18n key is the caller's responsibility). */
  readonly label: string;
  /** Field type for cell formatting. Default: "text". */
  readonly type?: string;
};

export type QueryTableProps<TData = unknown> = {
  /** Dispatcher-Query-Type (`<feature>:query:<entity>:<verb>`). */
  readonly query: string;
  readonly payload?: unknown;
  /** SSE invalidation — refetches on entity events (useQuery live mode). */
  readonly live?: boolean;
  readonly columns: readonly QueryTableColumn[];
  /** Extracts rows from the query result. Default: the result itself as an array. */
  readonly rows?: (data: TData) => readonly Readonly<Record<string, unknown>>[];
  /** Row ID for keys and row clicks. Default: `row.id`, otherwise the index. */
  readonly rowId?: (row: Readonly<Record<string, unknown>>, index: number) => string;
  readonly onRowClick?: DataTableProps["onRowClick"];
  readonly rowActions?: DataTableProps["rowActions"];
  /** Empty content — defaults to the standard list empty state. */
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
  if (error !== null)
    return <ErrorState error={error} onRetry={() => void refetch()} testId={testId} />;

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
