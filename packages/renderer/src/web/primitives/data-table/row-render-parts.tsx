import type { ReactNode } from "react";
import type { ListRowViewModel } from "../../../headless/index.ts";
import { cn } from "../../lib/cn.ts";
import { TableCell, TableRow } from "../../ui/table.tsx";
import { cellTitle } from "../data-table-cell.tsx";
import { type DataTableBandItem, GroupBand } from "./group-band.tsx";
import { EXPANSION_CELL_CLASS, EXPANSION_CONTENT_CLASS, RowExpandToggle } from "./table-chrome.tsx";
import type { DataTableModel } from "./use-data-table-state.ts";

// The expand toggle of a row, shared by table and card layout. Named after
// the first data column, the one a user recognizes the row by.
export function renderExpandToggle(m: DataTableModel, row: ListRowViewModel): ReactNode {
  const { expansion, expandedRowIds, columns, tableTranslate } = m;
  if (expansion === undefined) return null;
  const expanded = expandedRowIds?.has(row.id) === true;
  const firstColumn = columns[0];
  const title =
    (firstColumn !== undefined ? cellTitle(row.values[firstColumn.field]) : undefined) ?? "";
  const labelKey = expanded ? "kumiko.list.row.collapse" : "kumiko.list.row.expand";
  return (
    <RowExpandToggle
      expanded={expanded}
      controlsId={m.expansionDomId(row)}
      label={
        tableTranslate?.(labelKey, { title }) ?? `${expanded ? "Collapse" : "Expand"} ${title}`
      }
      onToggle={() => expansion.onToggleRowExpanded(row.id)}
      testId={`${m.rowTestId(row)}-toggle`}
    />
  );
}

export function renderExpansion(
  m: DataTableModel,
  row: ListRowViewModel,
  as: "row" | "item",
  colSpan: number,
): ReactNode {
  const { expansion, expandedRowIds } = m;
  if (expansion === undefined || expandedRowIds?.has(row.id) !== true) return null;
  const content = expansion.renderExpandedRow(row);
  if (as === "item") {
    return (
      <li
        id={m.expansionDomId(row)}
        data-testid={`${m.rowTestId(row)}-expansion`}
        className="border-b border-border-row bg-muted px-4 pt-1 pb-3.5"
      >
        {content}
      </li>
    );
  }
  return (
    <TableRow
      id={m.expansionDomId(row)}
      data-testid={`${m.rowTestId(row)}-expansion`}
      className="hover:bg-transparent"
    >
      <TableCell colSpan={colSpan} className={EXPANSION_CELL_CLASS}>
        <div className={EXPANSION_CONTENT_CLASS}>{content}</div>
      </TableCell>
    </TableRow>
  );
}

export function renderBand(m: DataTableModel, item: DataTableBandItem): ReactNode {
  return <GroupBand item={item} columnOf={m.columnOf} />;
}

export function renderEmptyBlock(m: DataTableModel): ReactNode {
  const { testId, chromeless, fillsHeight, emptyState, tableTranslate } = m;
  return (
    <div
      data-testid={testId !== undefined ? `${testId}-empty` : "render-list-empty"}
      className={cn(
        "flex flex-col items-center justify-center p-12 text-sm text-muted-foreground gap-3",
        chromeless !== true && !fillsHeight && "rounded-md border border-dashed",
      )}
    >
      {emptyState ?? <span>{tableTranslate?.("kumiko.list.no-entries") ?? "No entries."}</span>}
    </div>
  );
}
