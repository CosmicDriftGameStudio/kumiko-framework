import type { ReactNode } from "react";
import type { ListColumnViewModel, ListRowViewModel } from "../../../headless/index.ts";
import { cn } from "../../lib/cn.ts";
import { TableCell } from "../../ui/table.tsx";
import {
  cellLinkProp,
  cellTitle,
  DataTableCell,
  FIT_CONTENT_CELL_CLASS,
  FirstCellLink,
  isEmptyCellValue,
  NUMERIC_COLUMN_TYPES,
  TABULAR_COLUMN_TYPES,
} from "../data-table-cell.tsx";
import { columnCellPresentationProps } from "./data-cell-props.ts";
import { hintColumnWidthStyle } from "./hint-column-width.ts";
import { isRowActionColumn } from "./row-action-column.ts";
import type { DataTableModel } from "./use-data-table-state.ts";

// Cells stay on one line and end in "…" when the text does not fit (the full text is the
// cell's `title`); max-w-* bounds a column in the auto layout, where truncation needs a width.
// Hint cells wrap: their sentence and detail line are the row's content.
const ONE_LINE_COLUMN_TYPES: ReadonlySet<string> = new Set(["timestamp", "date"]);

// Projection lists synthesize every column as type "text"; their dates carry a format spec.
function isDateColumn(col: ListColumnViewModel): boolean {
  if (ONE_LINE_COLUMN_TYPES.has(col.type)) return true;
  const renderer: unknown = col.renderer;
  return (
    typeof renderer === "object" &&
    renderer !== null &&
    "format" in renderer &&
    typeof renderer.format === "string" &&
    ONE_LINE_COLUMN_TYPES.has(renderer.format)
  );
}

function autoLayoutCellClassName(
  m: DataTableModel,
  col: ListColumnViewModel,
  colIndex: number,
): string {
  if (m.sizing !== undefined && isDateColumn(col)) return "whitespace-nowrap";
  if (col.multiline === true) return "max-w-md whitespace-pre-line break-words";
  // max-w-xs would cap a hint column that states a wider width.
  if (col.hint !== undefined && col.width !== undefined) return "whitespace-normal break-words";
  if (col.hint !== undefined) return "max-w-xs whitespace-normal break-words";
  return colIndex === 0 ? "max-w-md truncate" : "max-w-xs truncate";
}

function fixedLayoutCellClassName(col: ListColumnViewModel): string {
  return col.hint !== undefined || col.multiline === true
    ? "overflow-hidden whitespace-normal break-words"
    : "overflow-hidden truncate";
}

function dataCellClassName(
  m: DataTableModel,
  row: ListRowViewModel,
  col: ListColumnViewModel,
  colIndex: number,
  pinClassName: string | undefined,
): string {
  return cn(
    col.fileDisplay === undefined
      ? m.sizing?.fixed === true
        ? fixedLayoutCellClassName(col)
        : autoLayoutCellClassName(m, col, colIndex)
      : FIT_CONTENT_CELL_CLASS,
    "px-3 first:pl-6 last:pr-[34px]",
    cellTextClass(m, row, col, colIndex),
    col.ellipsis === true && "truncate",
    col.multiline === true && "whitespace-pre-line",
    NUMERIC_COLUMN_TYPES.has(col.type) && "text-right",
    isRowActionColumn(col) && "sm:text-right",
    TABULAR_COLUMN_TYPES.has(col.type) && "tabular-nums",
    col.highlighted === true && "bg-accent/40",
    m.density.cell,
    m.density.cellHeight,
    pinClassName,
  );
}

function isMutedRow(m: DataTableModel, row: ListRowViewModel): boolean {
  return m.rowMuted?.(row) === true;
}

function cellTextClass(
  m: DataTableModel,
  row: ListRowViewModel,
  col: ListColumnViewModel,
  colIndex: number,
): string {
  if (col.tone === "muted") return "text-muted-foreground";
  if (col.emphasis === true) return "font-semibold text-foreground";
  if (isMutedRow(m, row)) return "text-muted-foreground";
  if (colIndex === 0 && !m.hasEmphasisColumn) return "font-medium text-foreground";
  return "text-foreground";
}

export function renderDataCell(
  m: DataTableModel,
  row: ListRowViewModel,
  col: ListColumnViewModel,
  colIndex: number,
  opensOnClick: boolean,
): ReactNode {
  const { getCellTestId, onCellChange, onRowClick, tableTranslate, tableLocale } = m;
  const bodyPin = m.pins.bodyCell(col.field);
  const linksFirstCell = colIndex === 0 && opensOnClick && onCellChange === undefined;
  const wrapsCellInOpener = linksFirstCell && col.hint === undefined;
  return (
    <TableCell
      key={col.field}
      data-testid={getCellTestId?.(row, col.field) ?? `cell-${row.id}-${col.field}`}
      data-highlighted={col.highlighted === true ? "true" : undefined}
      className={dataCellClassName(m, row, col, colIndex, bodyPin.className)}
      style={{ ...bodyPin.style, ...hintColumnWidthStyle(col, m.sizing !== undefined) }}
      title={cellTitle(row.values[col.field])}
    >
      <FirstCellLink
        enabled={wrapsCellInOpener}
        onOpen={() => onRowClick?.(row)}
        empty={col.hint === undefined && isEmptyCellValue(row.values[col.field])}
        emptyLabel={m.rowClickLabel}
        emptyPlaceholder={col.emptyPlaceholder}
      >
        <DataTableCell
          value={row.values[col.field]}
          row={row.values}
          field={col.field}
          type={col.type}
          renderer={col.renderer}
          translate={tableTranslate}
          locale={tableLocale}
          {...columnCellPresentationProps(col)}
          {...(col.fileDisplay !== undefined && {
            fileDisplay: col.fileDisplay,
          })}
          {...(onCellChange !== undefined && {
            onChange: (value: unknown) => onCellChange(row.id, col.field, value),
          })}
          {...cellLinkProp(col, row, !linksFirstCell)}
          {...(linksFirstCell && !wrapsCellInOpener && { onOpenRow: () => onRowClick?.(row) })}
        />
      </FirstCellLink>
    </TableCell>
  );
}
