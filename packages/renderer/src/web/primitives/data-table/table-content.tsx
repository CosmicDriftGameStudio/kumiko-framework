import type { ReactNode } from "react";
import { InfiniteSentinel, Pager } from "../pager.tsx";
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
  const { pager, serverGroups, itemNoun, testId } = m;
  if (pager === undefined || !(pager.total > 0) || serverGroups !== undefined) return undefined;
  return (
    <Pager
      page={pager.page}
      limit={pager.limit}
      total={pager.total}
      onPageChange={pager.onPageChange}
      {...(pager.pageSizeOptions !== undefined && { pageSizeOptions: pager.pageSizeOptions })}
      {...(pager.onPageSizeChange !== undefined && { onPageSizeChange: pager.onPageSizeChange })}
      {...(itemNoun !== undefined && { itemNoun })}
      testId={testId !== undefined ? `${testId}-pager` : "render-list-pager"}
      pinned={m.fillsHeight}
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

  // With scrollBody the footer (pager, else the entry count) sits OUTSIDE the
  // scroll surface so it stays put at any row count; the infinite sentinel
  // stays INSIDE, or it would never intersect the scrollport.
  if (!m.fillsHeight) {
    return (
      <>
        {m.selection.bar}
        {tableContent}
        {pagerElement}
        {sentinelElement}
      </>
    );
  }
  return (
    <>
      {m.selection.bar}
      <div
        data-testid={testId !== undefined ? `${testId}-scroll` : "render-list-scroll"}
        className="min-h-0 flex-1 overflow-auto border-t border-border bg-card"
      >
        {tableContent}
        {sentinelElement}
      </div>
      {pagerElement ?? (
        <DataTableFooter
          count={serverGroups?.totalCount ?? m.rows.length}
          {...(itemNoun !== undefined && { itemNoun })}
          testId={testId !== undefined ? `${testId}-footer` : "render-list-footer"}
        />
      )}
    </>
  );
}
