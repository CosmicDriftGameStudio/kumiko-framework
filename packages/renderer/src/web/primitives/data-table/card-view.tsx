import { cardColumnRoles } from "@cosmicdrift/kumiko-framework/ui-types";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { hasSeparateCardRows, isInsideCardFrame } from "./card-frame.ts";
import { renderCard } from "./card-row.tsx";
import { CardSortSelect } from "./card-sort-select.tsx";
import { bandClassName, bandReactKey, bandTestId } from "./group-band.tsx";
import { renderBand } from "./row-render-parts.tsx";
import { hasSortOptionsSelect, sortSummaryText } from "./sort-options-select.tsx";
import { SummaryCard, TotalsCard } from "./totals-footer.tsx";
import type { DataTableModel } from "./use-data-table-state.ts";

export function renderCardsView(m: DataTableModel): ReactNode {
  const { testId, totals, columns } = m;
  const roles = cardColumnRoles(columns);
  // Below sm the card sort line also carries the list size; from sm up the toolbar shows it.
  const toolbarOwnsSort =
    m.toolbarSort === true && !m.belowSm && hasSortOptionsSelect(m.sortOptions, m.onSortChange);
  const summary = m.belowSm ? sortSummaryText(m) : undefined;
  const separateCards = hasSeparateCardRows(m);
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
        <ul
          className={
            separateCards
              ? cn("m-0 flex list-none flex-col gap-2 p-0 pb-2", m.fillsHeight && "px-4")
              : isInsideCardFrame(m)
                ? "m-0 list-none p-0"
                : "m-0 list-none border-t border-border-row p-0"
          }
        >
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
        {m.summaryRow !== undefined && !m.belowSm && <SummaryCard summary={m.summaryRow} />}
        {totals !== undefined && <TotalsCard totals={totals} columnOf={m.columnOf} />}
      </div>
    </div>
  );
}
