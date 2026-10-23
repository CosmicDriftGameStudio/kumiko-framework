import { Fragment, type ReactNode } from "react";
import type { ListRowViewModel } from "../../../headless/index.ts";
import { cn } from "../../lib/cn.ts";
import { TableBody, TableCell, TableRow } from "../../ui/table.tsx";
import { rowToneClass } from "../data-table-cell.tsx";
import { RowActionsCell } from "../row-actions.tsx";
import { ActionsBodyCell } from "./actions-column.tsx";
import { bandClassName, bandReactKey, bandTestId, type DataTableBandItem } from "./group-band.tsx";
import { renderBand, renderExpandToggle, renderExpansion } from "./row-render-parts.tsx";
import { EXPAND_TOGGLE_CELL_CLASS } from "./table-chrome.tsx";
import { renderDataCell } from "./table-data-cell.tsx";
import { EXPAND_COLUMN_KEY, SELECT_COLUMN_KEY } from "./use-column-pins.ts";
import type { DataTableModel } from "./use-data-table-state.ts";

function renderBandRow(m: DataTableModel, item: DataTableBandItem): ReactNode {
  return (
    <TableRow key={bandReactKey(item)} data-testid={bandTestId(item)}>
      <TableCell colSpan={m.fullColSpan} className={bandClassName(item)}>
        {renderBand(m, item)}
      </TableCell>
    </TableRow>
  );
}

function renderExpandCell(m: DataTableModel, row: ListRowViewModel): ReactNode {
  const expandBodyPin = m.pins.bodyCell(EXPAND_COLUMN_KEY);
  return (
    <TableCell
      data-testid={m.getCellTestId?.(row, "expand") ?? `cell-${row.id}-expand`}
      className={cn(EXPAND_TOGGLE_CELL_CLASS, expandBodyPin.className)}
      style={expandBodyPin.style}
    >
      {renderExpandToggle(m, row)}
    </TableCell>
  );
}

function renderActionsCell(
  m: DataTableModel,
  row: ListRowViewModel,
  tableActions: NonNullable<DataTableModel["tableActions"]>,
): ReactNode {
  return (
    <ActionsBodyCell
      testId={m.getCellTestId?.(row, "actions") ?? `cell-${row.id}-actions`}
      fillsHeight={m.fillsHeight}
      measureContent={m.sizing !== undefined}
    >
      <RowActionsCell
        row={row}
        actions={tableActions}
        mode={m.rowActionMode}
        rowIsLink={m.onRowClick !== undefined}
      />
    </ActionsBodyCell>
  );
}

function renderDataRow(m: DataTableModel, row: ListRowViewModel): ReactNode {
  const { rowTone, density, tableActions } = m;
  const openRow = m.rowOpener(row);
  const opensOnClick = openRow !== undefined;
  const keyboard = m.keyboardRow(row.id, openRow);
  return (
    <Fragment key={row.id}>
      <TableRow
        data-testid={m.rowTestId(row)}
        data-tone={rowTone?.(row)}
        onClick={openRow}
        className={cn(
          rowToneClass(rowTone?.(row)),
          opensOnClick && "cursor-pointer",
          m.fillsHeight && "h-10 border-border-row hover:bg-muted",
          density.row,
          keyboard.className,
        )}
        {...keyboard.props}
      >
        {m.selection.bodyCell(row, m.pins.bodyCell(SELECT_COLUMN_KEY))}
        {m.expansion !== undefined && renderExpandCell(m, row)}
        {m.columns.map((col, colIndex) => renderDataCell(m, row, col, colIndex, opensOnClick))}
        {m.hasTableActions && tableActions !== undefined && renderActionsCell(m, row, tableActions)}
      </TableRow>
      {renderExpansion(m, row, "row", m.fullColSpan)}
    </Fragment>
  );
}

export function renderTableBody(m: DataTableModel): ReactNode {
  return (
    <TableBody>
      {m.tableItems.map((item) =>
        item.kind === "row" ? renderDataRow(m, item.row) : renderBandRow(m, item),
      )}
    </TableBody>
  );
}
