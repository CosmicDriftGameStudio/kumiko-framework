import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { InfiniteSentinel, Pager } from "../pager.tsx";
import { CARD_SURFACE_CLASS, hasSeparateCardRows, isInsideCardFrame } from "./card-frame.ts";
import { renderCardsView } from "./card-view.tsx";
import { renderEmptyBlock } from "./row-render-parts.tsx";
import { DataTableFooter } from "./table-footer.tsx";
import { renderTableView } from "./table-view.tsx";
import type { DataTableModel } from "./use-data-table-state.ts";

// The pager is ALWAYS rendered below the table (even with rows=[]) so the
// user can page back on a filter hit of zero without losing the list.
// Except total === 0: then there is nothing to paginate. Incompatible with
// infinite scroll: the caller sets either pager OR onReachEnd.
function renderPager(m: DataTableModel): ReactNode {
  const { pager, serverGroups, testId } = m;
  if (pager === undefined || !(pager.total > 0) || serverGroups !== undefined) return undefined;
  return (
    <Pager
      page={pager.page}
      limit={pager.limit}
      total={pager.total}
      onPageChange={pager.onPageChange}
      {...(pager.pageSizeOptions !== undefined && { pageSizeOptions: pager.pageSizeOptions })}
      {...(pager.onPageSizeChange !== undefined && { onPageSizeChange: pager.onPageSizeChange })}
      testId={testId !== undefined ? `${testId}-pager` : "render-list-pager"}
      pinned={m.fillsHeight || isInsideCardFrame(m)}
      plain={m.isNarrow && hasSeparateCardRows(m)}
    />
  );
}

function renderSentinel(m: DataTableModel, pagerElement: ReactNode): ReactNode {
  const { onReachEnd, serverGroups, testId } = m;
  if (pagerElement !== undefined || onReachEnd === undefined || serverGroups !== undefined) {
    return undefined;
  }
  return (
    <InfiniteSentinel
      onReachEnd={onReachEnd}
      loadingMore={m.loadingMore === true}
      hasMore={m.hasMore !== false}
      rowsCount={m.rows.length}
      testId={testId !== undefined ? `${testId}-sentinel` : "render-list-sentinel"}
    />
  );
}

function renderTableBodyContent(m: DataTableModel): ReactNode {
  if (m.isEmpty) return renderEmptyBlock(m);
  return m.isNarrow ? renderCardsView(m) : renderTableView(m);
}

export function renderTableContent(m: DataTableModel): ReactNode {
  const { testId, itemNoun, serverGroups } = m;
  const tableContent = renderTableBodyContent(m);
  const pagerElement = renderPager(m);
  const sentinelElement = renderSentinel(m, pagerElement);
  const framed = isInsideCardFrame(m);

  // With scrollBody the footer (pager, else the entry count) sits OUTSIDE the
  // scroll surface so it stays put at any row count; the infinite sentinel
  // stays INSIDE, or it would never intersect the scrollport.
  const content = m.fillsHeight ? (
    <div
      data-testid={testId !== undefined ? `${testId}-scroll` : "render-list-scroll"}
      className={cn("min-h-0 flex-1 overflow-auto bg-card", !framed && "border-t border-border")}
    >
      {tableContent}
      {sentinelElement}
    </div>
  ) : (
    <>
      {tableContent}
      {sentinelElement}
    </>
  );
  const footer =
    pagerElement ??
    (m.fillsHeight ? (
      <DataTableFooter
        count={serverGroups?.totalCount ?? m.rows.length}
        {...(itemNoun !== undefined && { itemNoun })}
        testId={testId !== undefined ? `${testId}-footer` : "render-list-footer"}
      />
    ) : undefined);

  // Frame card: content and footer share one bordered card. A fill-height card is as tall as
  // its rows and shrinks into the scroll container; the 24px sides match the toolbar's inset.
  return (
    <>
      {m.selection.bar}
      {framed ? (
        <div
          data-testid={testId !== undefined ? `${testId}-frame` : "render-list-frame"}
          className={cn(
            CARD_SURFACE_CLASS,
            "overflow-hidden",
            m.fillsHeight && "mx-6 mb-6 flex min-h-0 flex-col",
          )}
        >
          {content}
          {footer}
        </div>
      ) : (
        <>
          {content}
          {footer}
        </>
      )}
    </>
  );
}
