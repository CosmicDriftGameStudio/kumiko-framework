import { Fragment, type ReactNode } from "react";
import type { ListRowViewModel } from "../../../headless/index.ts";
import type { DataTableRowAction } from "../../../index.ts";
import { cn } from "../../lib/cn.ts";
import { cardToneClass } from "../data-table-cell.tsx";
import { RowActionsCell } from "../row-actions.tsx";
import { type CardRoles, renderCardBody, renderCardLinks, splitLinkColumns } from "./card-body.tsx";
import { renderExpandToggle, renderExpansion } from "./row-render-parts.tsx";
import type { DataTableModel } from "./use-data-table-state.ts";

// The card's <li> opens the row on click; controls inside must not reach it.
function renderStopPropagation(className: string, testId: string | undefined, children: ReactNode) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: stopPropagation only — not a control
    <div
      className={className}
      data-testid={testId}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}

function renderCardMenu(
  m: DataTableModel,
  row: ListRowViewModel,
  menuActions: NonNullable<DataTableModel["menuActions"]>,
): ReactNode {
  return renderStopPropagation(
    "shrink-0",
    undefined,
    <RowActionsCell
      row={row}
      actions={menuActions}
      mode={m.rowActionMode}
      rowIsLink={m.onRowClick !== undefined}
      compact
    />,
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

function renderCardButtons(
  m: DataTableModel,
  row: ListRowViewModel,
  buttonActions: readonly DataTableRowAction[],
): ReactNode {
  return renderStopPropagation(
    "flex justify-end",
    `row-${row.id}-card-buttons`,
    <RowActionsCell row={row} actions={buttonActions} mode={m.rowActionMode} compact />,
  );
}

function cardLeftPadding(compact: boolean, toned: boolean): string {
  if (compact) return toned ? "pl-[5px]" : "pl-2";
  return toned ? "pl-[13px]" : "pl-4";
}

export function renderCard(m: DataTableModel, row: ListRowViewModel, roles: CardRoles): ReactNode {
  const { rowTone } = m;
  const allActions = m.menuActions ?? [];
  const buttonActions = allActions.filter(
    (a) => a.display === "button" && (a.isVisible === undefined || a.isVisible(row)),
  );
  const menuActions = allActions.filter((a) => a.display !== "button");
  const hasMenu = menuActions.length > 0;
  const hasButtons = buttonActions.length > 0;
  const openRow = m.rowOpener(row);
  const { bodyRoles, linkColumns } = splitLinkColumns(m, row, roles);
  const body = renderCardBody(m, row, bodyRoles);
  const main = openRow !== undefined ? renderCardOpenButton(openRow, body) : body;
  const toned = cardToneClass(rowTone?.(row)) !== "";
  const rowItem = (
    <li
      key={row.id}
      data-testid={m.rowTestId(row)}
      data-tone={rowTone?.(row)}
      className={cn(
        "flex min-h-[72px] items-center gap-2 border-b border-border-row py-3",
        cardToneClass(rowTone?.(row)),
        // The 3px tone border sits inside the box, so the inner padding gives it up to keep the content aligned.
        cardLeftPadding(m.expansion !== undefined || m.selection.active, toned),
        hasMenu ? "pr-2" : "pr-4",
        m.density.card,
      )}
      {...(openRow !== undefined && { onClick: openRow })}
    >
      {m.selection.cardCheckbox(row)}
      {renderExpandToggle(m, row)}
      {linkColumns.length > 0 || hasButtons ? (
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {main}
          {linkColumns.length > 0 && renderCardLinks(m, row, linkColumns)}
          {hasButtons && renderCardButtons(m, row, buttonActions)}
        </div>
      ) : (
        main
      )}
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
