import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Table } from "../../ui/table.tsx";
import { ColumnWidthGroup } from "./column-resize-handle.tsx";
import { renderTableBody } from "./table-body.tsx";
import { FILL_TABLE_CLASS, FlushTable } from "./table-chrome.tsx";
import { renderTableHeader } from "./table-header-row.tsx";
import { TotalsFooterRow } from "./totals-footer.tsx";
import type { DataTableModel } from "./use-data-table-state.ts";

function renderColumnWidths(m: DataTableModel): ReactNode {
  const { sizing } = m;
  if (sizing === undefined || !sizing.fixed) return null;
  return (
    <ColumnWidthGroup
      fields={m.columns.map((col) => col.field)}
      sizing={sizing}
      hasExpandColumn={m.expansion !== undefined}
      hasSelectColumn={m.selection.active}
      hasActionsColumn={m.hasTableActions}
    />
  );
}

function renderTotalsRow(m: DataTableModel): ReactNode {
  const { totals } = m;
  if (totals === undefined) return null;
  return (
    <TotalsFooterRow
      totals={totals}
      columns={m.columns}
      cellPin={m.pins.bodyCell}
      leadingCells={{ select: m.selection.active, expand: m.expansion !== undefined }}
      actionsCell={m.hasTableActions ? { fillsHeight: m.fillsHeight } : undefined}
      cellClassName={m.density.cell}
    />
  );
}

export function renderTableView(m: DataTableModel): ReactNode {
  const { fillsHeight, chromeless, sizing, testId } = m;
  const TableRoot = fillsHeight ? FlushTable : Table;
  return (
    // dashboard-01 pattern: `rounded-lg border` frame, the header row
    // carries the bg-muted gray. `bg-card` (instead of transparent) -> the list
    // sits on the same card surface as forms; on themes with a colored page
    // background (e.g. cream) lists would otherwise not match the cards.
    // `chromeless` drops that frame for a host with its own boundary already (a tab panel).
    // `scrollBody`: the scroll surface and its border live on the wrapper
    // in renderTableContent (table-content.tsx), so the table renders frameless and without the
    // vendored `overflow-x-auto` container — that container would become
    // the sticky header's scrollport and the header would never stick.
    <div
      className={cn(
        !fillsHeight && "overflow-hidden",
        !fillsHeight && chromeless !== true && "rounded-lg border bg-card",
      )}
    >
      <TableRoot
        data-testid={testId}
        className={fillsHeight ? FILL_TABLE_CLASS : undefined}
        {...(sizing?.tableStyle !== undefined && { style: sizing.tableStyle })}
      >
        {renderColumnWidths(m)}
        {renderTableHeader(m)}
        {renderTableBody(m)}
        {renderTotalsRow(m)}
      </TableRoot>
    </div>
  );
}
