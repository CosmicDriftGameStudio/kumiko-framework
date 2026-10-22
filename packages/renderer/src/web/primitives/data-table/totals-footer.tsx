import type { ReactNode } from "react";
import type { DataTableMeasure, DataTableTotals } from "../../../data-table-aggregate-types.ts";
import type { ListColumnViewModel } from "../../../headless/index.ts";
import { useOptionalTranslation } from "../../../index.ts";
import { cn } from "../../lib/cn.ts";
import { TableCell, TableFooter, TableRow } from "../../ui/table.tsx";
import { NUMERIC_COLUMN_TYPES } from "../data-table-cell.tsx";
import { MeasureValue, measureKindLabel, measureLabel } from "./measure-value.tsx";
import type { PinnedCellProps } from "./use-column-pins.ts";

function measuresOf(totals: DataTableTotals, field: string): readonly DataTableMeasure[] {
  return totals.measures.filter((measure) => measure.field === field);
}

function fillerKeys(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, position) => `${prefix}-${position}`);
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

/** Footer row under the table body, one cell per visible column. */
export function TotalsFooterRow({
  totals,
  columns,
  cellPin,
  leadingCells,
  trailingCells,
  cellClassName,
}: {
  readonly totals: DataTableTotals;
  readonly columns: readonly ListColumnViewModel[];
  readonly cellPin: (field: string) => PinnedCellProps;
  readonly leadingCells: number;
  readonly trailingCells: number;
  readonly cellClassName?: string;
}): ReactNode {
  const translate = useOptionalTranslation();
  return (
    <TableFooter data-testid="list-totals">
      <TableRow className="hover:bg-transparent">
        {fillerKeys("lead", leadingCells).map((key) => (
          <TableCell key={key} />
        ))}
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
        {fillerKeys("trail", trailingCells).map((key) => (
          <TableCell key={key} />
        ))}
      </TableRow>
    </TableFooter>
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
