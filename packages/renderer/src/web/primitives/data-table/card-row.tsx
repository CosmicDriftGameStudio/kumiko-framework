import { Fragment, type ReactNode } from "react";
import type { ListRowViewModel } from "../../../headless/index.ts";
import type { DataTableRowAction } from "../../../index.ts";
import { cn } from "../../lib/cn.ts";
import { cardToneClass } from "../data-table-cell.tsx";
import { RowActionsCell } from "../row-actions.tsx";
import { type CardRoles, renderCardBody, renderCardLinks, splitLinkColumns } from "./card-body.tsx";
import { CARD_SURFACE_CLASS, hasSeparateCardRows } from "./card-frame.ts";
import { rowClickHandler } from "./row-click-guard.ts";
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
      onClick={(e) => {
        // The card's click guard skips clicks on buttons, so this one opens the row itself.
        e.stopPropagation();
        openRow();
      }}
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
    "flex justify-start",
    `row-${row.id}-card-buttons`,
    <RowActionsCell row={row} actions={buttonActions} mode={m.rowActionMode} compact small />,
  );
}

function cardLeftPadding(compact: boolean): string {
  return compact ? "pl-2" : "pl-4";
}

function cardRowBaseClass(m: DataTableModel): string {
  return hasSeparateCardRows(m)
    ? `flex min-h-[72px] items-center gap-2 py-3 ${CARD_SURFACE_CLASS}`
    : "flex min-h-[72px] items-center gap-2 border-b border-border-row py-3";
}

function splitCardActions(m: DataTableModel, row: ListRowViewModel, opensRow: boolean) {
  const menuMode = m.rowActionMode === "menu";
  // "menu" mode keeps every action in the table's kebab; a phone card opens the row instead,
  // unless the row cannot be opened, then the actions would be unreachable.
  const cardActions = menuMode && opensRow ? [] : (m.menuActions ?? []);
  return {
    buttonActions: cardActions.filter(
      (a) =>
        !menuMode &&
        (a.display === "button" || a.display === "link") &&
        (a.isVisible === undefined || a.isVisible(row)),
    ),
    menuActions: cardActions.filter(
      (a) => menuMode || (a.display !== "button" && a.display !== "link"),
    ),
  };
}

export function renderCard(m: DataTableModel, row: ListRowViewModel, roles: CardRoles): ReactNode {
  const { rowTone } = m;
  const openRow = m.rowOpener(row);
  const { buttonActions, menuActions } = splitCardActions(m, row, openRow !== undefined);
  const hasMenu = menuActions.length > 0;
  const hasButtons = buttonActions.length > 0;
  const { bodyRoles, linkColumns } = splitLinkColumns(m, row, roles);
  const body = renderCardBody(m, row, bodyRoles);
  const main = openRow !== undefined ? renderCardOpenButton(openRow, body) : body;
  // In a list with row tones every card carries a stripe (neutral = grey) so the cards align.
  const toneClass = cardToneClass(rowTone === undefined ? undefined : (rowTone(row) ?? "neutral"));
  const toned = toneClass !== "";
  const rowItem = (
    <li
      key={row.id}
      data-testid={m.rowTestId(row)}
      data-tone={rowTone?.(row)}
      className={cn(
        cardRowBaseClass(m),
        toneClass,
        // A toned card already pads past its inner 4px stripe (see cardToneClass); a later pl-* would override it.
        !toned && cardLeftPadding(m.expansion !== undefined || m.selection.active),
        hasMenu ? "pr-2" : "pr-4",
        m.density.card,
      )}
      {...(openRow !== undefined && { onClick: rowClickHandler(openRow) })}
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
