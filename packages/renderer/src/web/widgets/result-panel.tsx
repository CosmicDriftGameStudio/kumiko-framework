import type { ReactNode } from "react";
import { usePrimitives } from "../../index.ts";
import { cn } from "../lib/cn.ts";
import { DetailList } from "./detail-list.tsx";
import { SectionCard } from "./section-card.tsx";

/** Result section for a calculator: SectionCard with an empty state (Banner)
 *  or a metric list (DetailList) plus optional extras (table, notes).
 *  Replaces hand-built `<dl>`/banner blocks in custom screens. */
export function ResultPanel({
  title,
  subtitle,
  empty,
  emptyText,
  rows,
  footer,
  children,
  testId,
}: {
  readonly title: string;
  readonly subtitle?: string;
  readonly empty?: boolean;
  readonly emptyText?: ReactNode;
  readonly rows?: readonly {
    readonly label: string;
    readonly value: ReactNode;
    readonly emphasize?: boolean;
  }[];
  /** Action slot at the bottom of the card (e.g. "Move to financing"). */
  readonly footer?: ReactNode;
  readonly children?: ReactNode;
  readonly testId?: string;
}): ReactNode {
  const { Banner } = usePrimitives();
  return (
    <SectionCard title={title} subtitle={subtitle} footer={footer} testId={testId}>
      {empty === true ? (
        <Banner variant="info" padded>
          {emptyText}
        </Banner>
      ) : (
        <div className="flex flex-col gap-4">
          {rows !== undefined && rows.length > 0 && <DetailList rows={rows} />}
          {children}
        </div>
      )}
    </SectionCard>
  );
}

export interface ResultColumn<Row> {
  readonly header: string;
  readonly align?: "left" | "right";
  readonly cell: (row: Row) => ReactNode;
}

export interface ResultTableFooterRow {
  readonly label: string;
  readonly value: ReactNode;
  readonly emphasize?: boolean;
}

/** Static, prop-driven result table for calculated rows (tranches, scenarios).
 *  Avoids repeating the `<table>`+tabular-nums pattern in each screen.
 *  ponytail: intentionally minimal and read-only—for sorting, paging, or facets,
 *  use usePrimitives().DataTable or QueryTable instead. */
export function ResultTable<Row>({
  columns,
  rows,
  rowKey,
  testId,
  className,
  card,
  footer,
}: {
  readonly columns: readonly ResultColumn<Row>[];
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row, index: number) => string;
  readonly testId?: string;
  readonly className?: string;
  /** Framed appearance like the CRUD list (DataTable): rounded border container +
   *  bg-muted header band. Default = bare (table only, without a container). */
  readonly card?: boolean;
  /** Summary rows (Subtotal/Tax/Total) rendered as real `<tr>`s in the same
   *  `<table>` instead of a separate flex-div next to it — guarantees
   *  column-alignment to the last (typically "Amount") column instead of
   *  approximating it with an independent layout. */
  readonly footer?: readonly ResultTableFooterRow[];
}): ReactNode {
  const table = (
    <div className="overflow-x-auto">
      <table data-testid={testId} className={cn("w-full text-sm", className)}>
        <thead className={cn(card === true && "bg-muted")}>
          <tr className="border-b text-left text-muted-foreground">
            {columns.map((col) => (
              <th
                key={col.header}
                className={cn(
                  "py-1.5 font-medium",
                  card === true && "px-3",
                  col.align === "right" && "text-right",
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey(row, i)} className="border-b last:border-0">
              {columns.map((col) => (
                <td
                  key={col.header}
                  className={cn(
                    "py-1.5",
                    card === true && "px-3",
                    col.align === "right" && "text-right tabular-nums",
                  )}
                >
                  {col.cell(row)}
                </td>
              ))}
            </tr>
          ))}
          {footer?.map((row, i) => (
            <tr
              key={row.label}
              className={cn(i === 0 && "border-t", row.emphasize === true && "font-semibold")}
            >
              <td
                colSpan={columns.length > 1 ? Math.max(columns.length - 1, 1) : undefined}
                className={cn(
                  "py-1.5 text-muted-foreground",
                  card === true && "px-3",
                  row.emphasize === true && "text-foreground",
                  columns.length === 1 && "flex items-center justify-between gap-4",
                )}
              >
                {row.label}
                {columns.length === 1 && (
                  <span
                    className={cn(
                      "text-right tabular-nums",
                      row.emphasize === true && "text-foreground",
                    )}
                  >
                    {row.value}
                  </span>
                )}
              </td>
              {columns.length > 1 && (
                <td className={cn("py-1.5 text-right tabular-nums", card === true && "px-3")}>
                  {row.value}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return card === true ? (
    <div className="overflow-hidden rounded-lg border bg-card">{table}</div>
  ) : (
    table
  );
}

export interface ComparisonMetric<Col> {
  readonly label: string;
  readonly value: (col: Col, index: number) => ReactNode;
  /** Index of the best column for this row (highlighted); -1 = none. */
  readonly bestIndex?: (cols: readonly Col[]) => number;
}

/** Transposed comparison table: row = metric, column = variant, with the best
 *  column optionally highlighted for each metric. For scenario/offer comparisons
 *  where ResultTable (row = record) is not suitable. */
export function ComparisonTable<Col>({
  columns,
  columnHeader,
  columnKey,
  metrics,
  metricLabel,
  testId,
  className,
  card,
}: {
  readonly columns: readonly Col[];
  readonly columnHeader: (col: Col, index: number) => string;
  readonly columnKey: (col: Col, index: number) => string;
  readonly metrics: readonly ComparisonMetric<Col>[];
  readonly metricLabel: string;
  readonly testId?: string;
  readonly className?: string;
  /** Framed appearance like the CRUD list (DataTable): rounded border container +
   *  bg-muted header band. Default = bare. */
  readonly card?: boolean;
}): ReactNode {
  const table = (
    <div className="overflow-x-auto">
      <table data-testid={testId} className={cn("w-full min-w-[24rem] text-sm", className)}>
        <thead className={cn(card === true && "bg-muted")}>
          <tr className="border-b text-left text-muted-foreground">
            <th className={cn("py-1.5 font-medium", card === true && "px-3")}>{metricLabel}</th>
            {columns.map((col, i) => (
              <th
                key={columnKey(col, i)}
                className={cn("py-1.5 text-right font-medium", card === true && "px-3")}
              >
                {columnHeader(col, i)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {metrics.map((metric) => {
            const best = metric.bestIndex !== undefined ? metric.bestIndex(columns) : -1;
            return (
              <tr key={metric.label} className="border-b last:border-0">
                <td className={cn("py-1.5 text-muted-foreground", card === true && "px-3")}>
                  {metric.label}
                </td>
                {columns.map((col, i) => (
                  <td
                    key={columnKey(col, i)}
                    className={cn("py-1.5 text-right tabular-nums", card === true && "px-3")}
                  >
                    {i === best ? (
                      <span className="inline-block rounded bg-primary/10 px-2 py-0.5 font-semibold text-primary">
                        {metric.value(col, i)}
                      </span>
                    ) : (
                      metric.value(col, i)
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
  return card === true ? (
    <div className="overflow-hidden rounded-lg border bg-card">{table}</div>
  ) : (
    table
  );
}
