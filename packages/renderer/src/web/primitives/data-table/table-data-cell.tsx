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
import type { DataTableModel } from "./use-data-table-state.ts";

// Text wraps instead of truncating: nowrap cells keep their
// full width, so a wide table scrolled sideways and its
// last column slid under the sticky actions column with
// nothing visibly cut off. max-w-xs bounds a single column;
// badges and dates stay nowrap by their own classes.
// A resizable table sizes by content until the user drags a column. Its
// first column names the row and gets the room it needs: it breaks anywhere
// only when the table runs out of width, so a long identifier stays on one
// line on a wide screen instead of wrapping at 20rem.
function autoLayoutCellClassName(m: DataTableModel, colIndex: number): string {
  return colIndex === 0 && m.sizing !== undefined
    ? "whitespace-normal [overflow-wrap:anywhere]"
    : "max-w-xs whitespace-normal break-words";
}

function dataCellClassName(
  m: DataTableModel,
  col: ListColumnViewModel,
  colIndex: number,
  pinClassName: string | undefined,
): string {
  return cn(
    col.fileDisplay === undefined
      ? m.sizing?.fixed === true
        ? "overflow-hidden whitespace-normal break-words"
        : autoLayoutCellClassName(m, colIndex)
      : FIT_CONTENT_CELL_CLASS,
    colIndex === 0 ? "font-medium text-foreground" : "text-foreground-secondary",
    NUMERIC_COLUMN_TYPES.has(col.type) && "text-right",
    TABULAR_COLUMN_TYPES.has(col.type) && "tabular-nums",
    col.highlighted === true && "bg-accent/40",
    m.density.cell,
    pinClassName,
  );
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
  return (
    <TableCell
      key={col.field}
      data-testid={getCellTestId?.(row, col.field) ?? `cell-${row.id}-${col.field}`}
      data-highlighted={col.highlighted === true ? "true" : undefined}
      className={dataCellClassName(m, col, colIndex, bodyPin.className)}
      style={bodyPin.style}
      title={cellTitle(row.values[col.field])}
    >
      <FirstCellLink
        enabled={linksFirstCell}
        onOpen={() => onRowClick?.(row)}
        empty={isEmptyCellValue(row.values[col.field])}
        emptyLabel={m.rowClickLabel}
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
        />
      </FirstCellLink>
    </TableCell>
  );
}
