import { Fragment, type ReactNode } from "react";
import type { ListRowViewModel } from "../../../headless/index.ts";
import { cn } from "../../lib/cn.ts";
import { rowToneClass } from "../data-table-cell.tsx";
import { RowActionsCell } from "../row-actions.tsx";
import { type CardRoles, renderCardBody } from "./card-body.tsx";
import { renderExpandToggle, renderExpansion } from "./row-render-parts.tsx";
import type { DataTableModel } from "./use-data-table-state.ts";

function renderCardMenu(
  m: DataTableModel,
  row: ListRowViewModel,
  menuActions: NonNullable<DataTableModel["menuActions"]>,
): ReactNode {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: stopPropagation only — not a control
    <div
      className="shrink-0"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <RowActionsCell
        row={row}
        actions={menuActions}
        mode={m.rowActionMode}
        rowIsLink={m.onRowClick !== undefined}
        compact
      />
    </div>
  );
}

function renderCardOpenButton(openRow: () => void, body: ReactNode): ReactNode {
  return (
    <button
      type="button"
      className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 bg-transparent p-0 text-left"
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        e.stopPropagation();
        openRow();
      }}
    >
      {body}
    </button>
  );
}

export function renderCard(m: DataTableModel, row: ListRowViewModel, roles: CardRoles): ReactNode {
  const { rowTone, menuActions } = m;
  const hasMenu = menuActions !== undefined && menuActions.length > 0;
  const openRow = m.rowOpener(row);
  const body = renderCardBody(m, row, roles);
  const rowItem = (
    <li
      key={row.id}
      data-testid={m.rowTestId(row)}
      data-tone={rowTone?.(row)}
      className={cn(
        "flex min-h-[72px] items-center gap-2 border-b border-border-row py-3",
        rowToneClass(rowTone?.(row)),
        m.expansion !== undefined || m.selection.active ? "pl-2" : "pl-4",
        hasMenu ? "pr-2" : "pr-4",
        m.density.card,
      )}
      {...(openRow !== undefined && { onClick: openRow })}
    >
      {m.selection.cardCheckbox(row)}
      {renderExpandToggle(m, row)}
      {openRow !== undefined ? renderCardOpenButton(openRow, body) : body}
      {hasMenu && renderCardMenu(m, row, menuActions)}
    </li>
  );
  if (m.expansion === undefined) return rowItem;
  // The expansion is a sibling <li>, outside the row's click target, so
  // clicks in the sub-area never navigate the parent row.
  return (
    <Fragment key={row.id}>
      {rowItem}
      {renderExpansion(m, row, "item", 0)}
    </Fragment>
  );
}
