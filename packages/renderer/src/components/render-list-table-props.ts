import type { ListNarrowFacets } from "@cosmicdrift/kumiko-types/screen";
import type { ReactNode } from "react";
import type { DataTableProps } from "../primitives.tsx";
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
  p: Pick2<
    | "sort"
    | "onSortChange"
    | "sortOptions"
    | "toolbarSort"
    | "pager"
    | "onReachEnd"
    | "loadingMore"
    | "hasMore"
  > & {
    readonly narrowFacets?: ListNarrowFacets;
    readonly screenToolbarSort?: boolean;
    /** A stand-in screen is a locked preview: no paging. */
    readonly isStandIn: boolean;
  },
) {
  const { sort, onSortChange, sortOptions, onReachEnd, loadingMore, hasMore } = p;
  const toolbarSort = p.toolbarSort ?? p.screenToolbarSort;
  const pager = p.isStandIn ? undefined : p.pager;
  return {
    ...(p.narrowFacets !== undefined && { narrowFacets: p.narrowFacets }),
    ...(sort !== undefined && { sort }),
    ...(onSortChange !== undefined && { onSortChange }),
    ...(sortOptions !== undefined && { sortOptions }),
    ...(toolbarSort === true && { toolbarSort }),
    ...(pager !== undefined && { pager }),
    ...(onReachEnd !== undefined && { onReachEnd }),
    ...(loadingMore !== undefined && { loadingMore }),
    ...(hasMore !== undefined && { hasMore }),
  };
}

export function tableRowProps(
  p: Pick2<"rowActions" | "rowActionMode" | "bulk" | "rowTone"> & {
    readonly rowMuted: DataTableProps["rowMuted"];
  },
) {
  const { rowActions, rowActionMode, bulk, rowTone, rowMuted } = p;
  return {
    ...(rowActions !== undefined && { rowActions }),
    ...(rowActionMode !== undefined && { rowActionMode }),
    ...(bulk !== undefined && { bulk }),
    ...(rowTone !== undefined && { rowTone }),
    ...(rowMuted !== undefined && { rowMuted }),
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
    | "hideCountFooter"
    | "plainPhoneCards"
    | "screenPadding"
    | "expandedRowIds"
    | "onToggleRowExpanded"
    | "renderExpandedRow"
  > & { readonly isStandIn: boolean },
) {
  const {
    chromeless,
    scrollBody,
    plainPhoneCards,
    screenPadding,
    expandedRowIds,
    onToggleRowExpanded,
    renderExpandedRow,
  } = p;
  const hideCountFooter = p.isStandIn || p.hideCountFooter === true;
  return {
    ...(chromeless !== undefined && { chromeless }),
    ...(scrollBody !== undefined && { scrollBody }),
    ...(hideCountFooter && { hideCountFooter }),
    ...(plainPhoneCards !== undefined && { plainPhoneCards }),
    ...(screenPadding !== undefined && { screenPadding }),
    ...(expandedRowIds !== undefined && { expandedRowIds }),
    ...(onToggleRowExpanded !== undefined && { onToggleRowExpanded }),
    ...(renderExpandedRow !== undefined && { renderExpandedRow }),
  };
}
