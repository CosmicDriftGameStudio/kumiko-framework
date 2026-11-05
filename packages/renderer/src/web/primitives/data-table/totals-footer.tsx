import type { ReactNode } from "react";
import { uniqueLabelKeys } from "../../../app/unique-label-keys.ts";
import type { DataTableMeasure, DataTableTotals } from "../../../data-table-aggregate-types.ts";
import type { DataTableSummaryRow } from "../../../data-table-view-types.ts";
import type { ListColumnViewModel } from "../../../headless/index.ts";
import { useOptionalTranslation } from "../../../index.ts";
import { cn } from "../../lib/cn.ts";
import { TableCell, TableRow } from "../../ui/table.tsx";
import { NUMERIC_COLUMN_TYPES } from "../data-table-cell.tsx";
import { stickyActionsCellClass } from "./actions-column.tsx";
import { HINT_TONE_TEXT_CLASS } from "./hint-cell.tsx";
import { MeasureValue, measureKindLabel, measureLabel } from "./measure-value.tsx";
import { EXPAND_COLUMN_KEY, type PinnedCellProps, SELECT_COLUMN_KEY } from "./use-column-pins.ts";

function measuresOf(totals: DataTableTotals, field: string): readonly DataTableMeasure[] {
  return totals.measures.filter((measure) => measure.field === field);
}

// Same order as the body row: select before expand.
function leadingCellKeys(leading: {
  readonly select: boolean;
  readonly expand: boolean;
}): string[] {
  return [
    ...(leading.select ? [SELECT_COLUMN_KEY] : []),
    ...(leading.expand ? [EXPAND_COLUMN_KEY] : []),
  ];
}

function totalsLabel(translate: ReturnType<typeof useOptionalTranslation>): string {
  return translate?.("kumiko.list.totals.label") ?? "Total";
}

function FooterMeasures({
  measures,
  column,
}: {
  readonly measures: readonly DataTableMeasure[];
  readonly column: ListColumnViewModel;
}): ReactNode {
  const translate = useOptionalTranslation();
  if (measures.length === 1 && measures[0]?.kind === "sum") {
    return <MeasureValue measure={measures[0]} column={column} />;
  }
  return (
    <span className="inline-flex flex-col gap-0.5">
      {measures.map((measure) => (
        <span key={measure.kind} className="inline-flex items-baseline justify-end gap-1.5">
          <span className="text-xs font-normal text-muted-foreground">
            {measureKindLabel(measure.kind, translate)}
          </span>
          <MeasureValue measure={measure} column={column} />
        </span>
      ))}
    </span>
  );
}

function SummaryItems({ summary }: { readonly summary: DataTableSummaryRow }): ReactNode {
  const keys = uniqueLabelKeys(summary.items.map((item) => item.label ?? String(item.value)));
  return (
    <span className="text-sm text-muted-foreground">
      {summary.items.map((item, index) => (
        <span key={keys[index]} data-testid="list-summary-item">
          {index > 0 && " · "}
          {item.label !== undefined && `${item.label} `}
          <span
            className={cn(
              "font-medium tabular-nums text-foreground",
              item.tone !== undefined && HINT_TONE_TEXT_CLASS[item.tone],
            )}
          >
            {item.value}
          </span>
        </span>
      ))}
    </span>
  );
}

function SummaryCellValues({ items }: { readonly items: DataTableSummaryRow["items"] }): ReactNode {
  return items.map((item) => (
    <span
      key={`${item.column ?? ""}-${item.label ?? ""}-${item.value}`}
      data-testid="list-summary-item"
      className={cn(
        "me-2 font-medium tabular-nums text-foreground",
        item.tone !== undefined && HINT_TONE_TEXT_CLASS[item.tone],
      )}
    >
      {item.value}
    </span>
  ));
}

/** Full-width row above the totals row, inside the same tfoot; the summary query's "label value · label value" pairs.
 *  When an item names a `column`, the row is drawn as table cells under their columns instead, without labels. */
export function SummaryFooterRow({
  summary,
  colSpan,
  cellClassName,
  columns,
  cellPin,
  leadingCells,
  actionsCell,
}: {
  readonly summary: DataTableSummaryRow;
  readonly colSpan: number;
  readonly cellClassName?: string;
  readonly columns: readonly ListColumnViewModel[];
  readonly cellPin: (field: string) => PinnedCellProps;
  readonly leadingCells: { readonly select: boolean; readonly expand: boolean };
  readonly actionsCell: { readonly fillsHeight: boolean } | undefined;
}): ReactNode {
  if (summary.items.some((item) => item.column !== undefined) && columns.length > 0) {
    const fields = new Set(columns.map((column) => column.field));
    const firstField = columns[0]?.field;
    // An item naming a column that is not shown lands in the first column instead of vanishing.
    const columnOf = (item: DataTableSummaryRow["items"][number]): string | undefined =>
      item.column !== undefined && fields.has(item.column) ? item.column : firstField;
    return (
      <TableRow data-testid="list-summary" className="hover:bg-transparent">
        {leadingCellKeys(leadingCells).map((key) => {
          const pin = cellPin(key);
          return <TableCell key={key} className={pin.className} style={pin.style} />;
        })}
        {columns.map((column) => {
          const pin = cellPin(column.field);
          const items = summary.items.filter((item) => columnOf(item) === column.field);
          return (
            <TableCell
              key={column.field}
              data-testid={`list-summary-${column.field}`}
              className={cn(
                NUMERIC_COLUMN_TYPES.has(column.type) && "text-right",
                cellClassName,
                pin.className,
              )}
              style={pin.style}
            >
              <SummaryCellValues items={items} />
            </TableCell>
          );
        })}
        {actionsCell !== undefined && (
          <TableCell className={stickyActionsCellClass(actionsCell.fillsHeight, true)} />
        )}
      </TableRow>
    );
  }
  return (
    <TableRow data-testid="list-summary" className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className={cn("text-left", cellClassName)}>
        <SummaryItems summary={summary} />
      </TableCell>
    </TableRow>
  );
}

export function SummaryCard({ summary }: { readonly summary: DataTableSummaryRow }): ReactNode {
  return (
    <div
      data-testid="list-summary"
      className="border-b border-border-row bg-muted/50 px-4 py-3 text-left"
    >
      <SummaryItems summary={summary} />
    </div>
  );
}

/** Footer row under the table body, one cell per visible column. */
export function TotalsFooterRow({
  totals,
  columns,
  cellPin,
  leadingCells,
  actionsCell,
  cellClassName,
}: {
  readonly totals: DataTableTotals;
  readonly columns: readonly ListColumnViewModel[];
  readonly cellPin: (field: string) => PinnedCellProps;
  readonly leadingCells: { readonly select: boolean; readonly expand: boolean };
  /** Present when the table has an actions column; the cell then sticks like that column. */
  readonly actionsCell: { readonly fillsHeight: boolean } | undefined;
  readonly cellClassName?: string;
}): ReactNode {
  const translate = useOptionalTranslation();
  return (
    <TableRow data-testid="list-totals" className="hover:bg-transparent">
      {leadingCellKeys(leadingCells).map((key) => {
        const pin = cellPin(key);
        return (
          <TableCell
            key={key}
            data-testid={`list-totals-${key}`}
            className={pin.className}
            style={pin.style}
          />
        );
      })}
      {columns.map((column, index) => {
        const measures = measuresOf(totals, column.field);
        const pin = cellPin(column.field);
        return (
          <TableCell
            key={column.field}
            data-testid={`list-totals-${column.field}`}
            className={cn(
              "tabular-nums",
              NUMERIC_COLUMN_TYPES.has(column.type) && "text-right",
              cellClassName,
              pin.className,
            )}
            style={pin.style}
          >
            {measures.length > 0 ? (
              <FooterMeasures measures={measures} column={column} />
            ) : index === 0 ? (
              totalsLabel(translate)
            ) : null}
          </TableCell>
        );
      })}
      {actionsCell !== undefined && (
        <TableCell className={stickyActionsCellClass(actionsCell.fillsHeight, true)} />
      )}
    </TableRow>
  );
}

/** Card layout: the totals as a labelled list under the cards. */
export function TotalsCard({
  totals,
  columnOf,
}: {
  readonly totals: DataTableTotals;
  readonly columnOf: (field: string) => ListColumnViewModel | undefined;
}): ReactNode {
  const translate = useOptionalTranslation();
  return (
    <dl
      data-testid="list-totals"
      className="m-0 flex flex-col gap-1 border-b border-border-row bg-muted/50 px-4 py-3 text-sm"
    >
      {totals.measures.map((measure) => {
        const column = columnOf(measure.field);
        return (
          <div
            key={`${measure.kind}-${measure.field}`}
            data-testid={`list-totals-${measure.field}`}
            className="flex items-baseline justify-between gap-3"
          >
            <dt className="text-muted-foreground">{measureLabel(measure, column, translate)}</dt>
            <dd className="m-0 font-medium tabular-nums">
              <MeasureValue measure={measure} column={column} />
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
