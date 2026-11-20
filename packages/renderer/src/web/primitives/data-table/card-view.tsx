import { cardColumnRoles } from "@cosmicdrift/kumiko-framework/ui-types";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { hasSeparateCardRows, isInsideCardFrame } from "./card-frame.ts";
import { renderCard } from "./card-row.tsx";
import { CardSortSelect } from "./card-sort-select.tsx";
import { bandClassName, bandReactKey, bandTestId } from "./group-band.tsx";
import { renderBand } from "./row-render-parts.tsx";
import { hasSortOptionsSelect, sortSummaryText } from "./sort-options-select.tsx";
import { FooterRowsCard, SummaryCard, TotalsCard } from "./totals-footer.tsx";
import type { DataTableModel } from "./use-data-table-state.ts";

function cardListClassName(m: DataTableModel): string {
  if (hasSeparateCardRows(m)) {
    return cn("m-0 flex list-none flex-col gap-2 p-0 pb-2", m.fillsHeight && "px-4");
  }
  return isInsideCardFrame(m)
    ? "m-0 list-none p-0"
    : "m-0 list-none border-t border-border-row p-0";
}

function renderCardList(m: DataTableModel): ReactNode {
  const roles = cardColumnRoles(m.columns);
  return (
    <ul className={cardListClassName(m)}>
      {m.tableItems.map((item) =>
        item.kind === "row" ? (
          renderCard(m, item.row, roles)
        ) : (
          <li
            key={bandReactKey(item)}
            data-testid={bandTestId(item)}
            className={cn("border-b border-border-row", bandClassName(item))}
          >
            {renderBand(m, item)}
          </li>
        ),
      )}
    </ul>
  );
}

function renderCardsTrailer(m: DataTableModel): ReactNode {
  const { totals, columns } = m;
  return (
    <>
      {m.summaryRow !== undefined && !m.belowSm && <SummaryCard summary={m.summaryRow} />}
      {totals !== undefined && <TotalsCard totals={totals} columnOf={m.columnOf} />}
      {m.footerRows !== undefined && m.footerRows.length > 0 && (
        <FooterRowsCard rows={m.footerRows} columns={columns} />
      )}
    </>
  );
}

export function renderCardsView(m: DataTableModel): ReactNode {
  const { testId, columns } = m;
  // Below sm the card sort line also carries the list size; from sm up the toolbar shows it.
  const toolbarOwnsSort =
    m.toolbarSort === true && !m.belowSm && hasSortOptionsSelect(m.sortOptions, m.onSortChange);
  const summary = m.belowSm ? sortSummaryText(m) : undefined;
  return (
    <div data-testid={testId} className="contents">
      <div
        data-testid={testId !== undefined ? `${testId}-cards` : "render-list-cards"}
        className="flex flex-col"
      >
        {!toolbarOwnsSort && m.plainPhoneCards !== true && (
          <CardSortSelect
            columns={columns}
            sort={m.sort}
            onSortChange={m.onSortChange}
            testId={testId}
            summary={summary}
            {...(m.sortOptions !== undefined && { sortOptions: m.sortOptions })}
          />
        )}
        {renderCardList(m)}
        {renderCardsTrailer(m)}
      </div>
    </div>
  );
}
