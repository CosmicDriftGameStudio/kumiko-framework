import type { ReactNode } from "react";
import type { RenderListProps } from "./render-list-types.ts";

type Pick2<K extends keyof RenderListProps> = Pick<RenderListProps, K>;

export function tableChromeProps(
  p: Pick2<"onRowClick" | "description"> & {
    readonly composedEmptyState: ReactNode;
    readonly toolbarStart: ReactNode;
    readonly toolbarEnd: ReactNode;
    readonly itemNoun: ((count: number) => string) | undefined;
  },
) {
  const { onRowClick, composedEmptyState, toolbarStart, description, toolbarEnd, itemNoun } = p;
  return {
    ...(onRowClick !== undefined && { onRowClick }),
    ...(composedEmptyState !== undefined && { emptyState: composedEmptyState }),
    ...(toolbarStart !== undefined && { toolbarStart }),
    ...(description !== undefined && { toolbarDescription: description }),
    ...(toolbarEnd !== undefined && { toolbarEnd }),
    ...(itemNoun !== undefined && { itemNoun }),
  };
}

export function tableSortPagingProps(
  p: Pick2<"sort" | "onSortChange" | "pager" | "onReachEnd" | "loadingMore" | "hasMore">,
) {
  const { sort, onSortChange, pager, onReachEnd, loadingMore, hasMore } = p;
  return {
    ...(sort !== undefined && { sort }),
    ...(onSortChange !== undefined && { onSortChange }),
    ...(pager !== undefined && { pager }),
    ...(onReachEnd !== undefined && { onReachEnd }),
    ...(loadingMore !== undefined && { loadingMore }),
    ...(hasMore !== undefined && { hasMore }),
  };
}

export function tableRowProps(p: Pick2<"rowActions" | "rowActionMode" | "bulk" | "rowTone">) {
  const { rowActions, rowActionMode, bulk, rowTone } = p;
  return {
    ...(rowActions !== undefined && { rowActions }),
    ...(rowActionMode !== undefined && { rowActionMode }),
    ...(bulk !== undefined && { bulk }),
    ...(rowTone !== undefined && { rowTone }),
  };
}

export function tableFilterProps(
  p: Pick2<
    | "filterFacets"
    | "filterValues"
    | "onFilterChange"
    | "onFilterReset"
    | "dateRangeFacets"
    | "onDateRangeChange"
  >,
) {
  const {
    filterFacets,
    filterValues,
    onFilterChange,
    onFilterReset,
    dateRangeFacets,
    onDateRangeChange,
  } = p;
  return {
    ...(filterFacets !== undefined && { filterFacets }),
    ...(filterValues !== undefined && { filterValues }),
    ...(onFilterChange !== undefined && { onFilterChange }),
    ...(onFilterReset !== undefined && { onFilterReset }),
    ...(dateRangeFacets !== undefined && { dateRangeFacets }),
    ...(onDateRangeChange !== undefined && { onDateRangeChange }),
  };
}

export function tableLayoutProps(
  p: Pick2<
    | "chromeless"
    | "scrollBody"
    | "screenPadding"
    | "expandedRowIds"
    | "onToggleRowExpanded"
    | "renderExpandedRow"
  >,
) {
  const {
    chromeless,
    scrollBody,
    screenPadding,
    expandedRowIds,
    onToggleRowExpanded,
    renderExpandedRow,
  } = p;
  return {
    ...(chromeless !== undefined && { chromeless }),
    ...(scrollBody !== undefined && { scrollBody }),
    ...(screenPadding !== undefined && { screenPadding }),
    ...(expandedRowIds !== undefined && { expandedRowIds }),
    ...(onToggleRowExpanded !== undefined && { onToggleRowExpanded }),
    ...(renderExpandedRow !== undefined && { renderExpandedRow }),
  };
}
