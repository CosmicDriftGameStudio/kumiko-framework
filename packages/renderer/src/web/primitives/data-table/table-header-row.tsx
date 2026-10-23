import type { ReactNode } from "react";
import type { ListColumnViewModel } from "../../../headless/index.ts";
import { cn } from "../../lib/cn.ts";
import { TableHead, TableHeader, TableRow } from "../../ui/table.tsx";
import { NUMERIC_COLUMN_TYPES } from "../data-table-cell.tsx";
import { ActionsHeaderCell } from "./actions-column.tsx";
import { ColumnResizeHandle } from "./column-resize-handle.tsx";
import { SortableHeader } from "./sortable-header.tsx";
import { EXPAND_TOGGLE_CELL_CLASS } from "./table-chrome.tsx";
import { EXPAND_COLUMN_KEY, SELECT_COLUMN_KEY } from "./use-column-pins.ts";
import type { DataTableModel } from "./use-data-table-state.ts";

function renderColumnHeader(m: DataTableModel, col: ListColumnViewModel): ReactNode {
  const { sizing, sort, onSortChange } = m;
  const headerPin = m.pins.headerCell(col.field);
  return (
    <SortableHeader
      key={col.field}
      field={col.field}
      label={col.label}
      sortable={col.sortable === true}
      highlighted={col.highlighted === true}
      numeric={NUMERIC_COLUMN_TYPES.has(col.type)}
      fitContent={col.fileDisplay !== undefined}
      className={cn(m.density.header, headerPin.className)}
      style={headerPin.style}
      columnField={headerPin.columnField}
      trailing={
        sizing && <ColumnResizeHandle field={col.field} label={col.label} sizing={sizing} />
      }
      {...(sort !== undefined && sort !== null && { sort })}
      {...(onSortChange !== undefined && { onSortChange })}
    />
  );
}

function renderExpandHeaderCell(m: DataTableModel): ReactNode {
  const expandHeaderPin = m.pins.headerCell(EXPAND_COLUMN_KEY);
  return (
    <TableHead
      data-testid="column-expand"
      className={cn(EXPAND_TOGGLE_CELL_CLASS, expandHeaderPin.className)}
      style={expandHeaderPin.style}
    />
  );
}

export function renderTableHeader(m: DataTableModel): ReactNode {
  return (
    <TableHeader className="bg-muted">
      <TableRow ref={m.headerRowRef} className="hover:bg-transparent">
        {m.selection.headerCell(m.pins.headerCell(SELECT_COLUMN_KEY))}
        {m.expansion !== undefined && renderExpandHeaderCell(m)}
        {m.columns.map((col) => renderColumnHeader(m, col))}
        {m.hasTableActions && (
          <ActionsHeaderCell
            label={m.tableTranslate?.("kumiko.list.actions") ?? "Actions"}
            style={m.pins.actionsHeaderStyle}
            absorbsLeftover={m.sizing !== undefined}
          />
        )}
      </TableRow>
    </TableHeader>
  );
}
