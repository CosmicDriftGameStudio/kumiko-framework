import type { ProjectionListScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { ListRowViewModel, Translate } from "../headless/index.ts";
import type { ListUrlStateApi } from "../hooks/use-list-url-state.ts";
import { screenFillsHeight } from "../screen-fills-height.ts";
import { routeFacetChange, withNamedFilterValues } from "./named-filter-facet.ts";
import type { useProjectionListActions } from "./use-projection-list-actions.ts";
import type { useProjectionListData } from "./use-projection-list-data.ts";
import type { useProjectionListDefinitions } from "./use-projection-list-definitions.ts";
import type { useProjectionListQuery } from "./use-projection-list-query.ts";
import type { listPager } from "./use-screen-list-rows.ts";

export function projectionLeadProps(
  screen: ProjectionListScreenDefinition,
  effectiveTranslate: Translate,
  emptyContent: ReturnType<typeof useProjectionListActions>["emptyContent"],
) {
  return {
    ...(screen.description !== undefined && {
      description: effectiveTranslate(screen.description),
    }),
    ...(emptyContent !== undefined && { emptyContent }),
  };
}

export function projectionLayoutProps(
  isEmbeddedScreen: boolean,
  screen: ProjectionListScreenDefinition,
  listScreen: ReturnType<typeof useProjectionListDefinitions>["listScreen"],
  pager: ReturnType<typeof listPager>,
  rowActions: ReturnType<typeof useProjectionListActions>["rowActions"],
) {
  return {
    ...(isEmbeddedScreen ? { screenPadding: false, chromeless: true } : { screenPadding: true }),
    ...(screenFillsHeight(listScreen) && { scrollBody: true }),
    ...(pager !== undefined && { pager }),
    ...(rowActions !== undefined && { rowActions }),
    ...(screen.rowActionMode !== undefined && { rowActionMode: screen.rowActionMode }),
  };
}

export function projectionActionProps(
  actions: ReturnType<typeof useProjectionListActions>,
  translate: Translate | undefined,
  wrappedOnRowClick: ((row: ListRowViewModel) => void) | undefined,
) {
  const { bulk, toolbarActions } = actions;
  return {
    ...(bulk !== undefined && { bulk }),
    ...(toolbarActions !== undefined && { toolbarActions }),
    ...(translate !== undefined && { translate }),
    ...(wrappedOnRowClick !== undefined && { onRowClick: wrappedOnRowClick }),
  };
}

export function projectionFacetProps(
  filterFacets: ReturnType<typeof useProjectionListData>["filterFacets"],
  dateRangeFacets: ReturnType<typeof useProjectionListQuery>["dateRangeFacets"],
  onDateRangeChange: ReturnType<typeof useProjectionListQuery>["handleDateRangeChange"],
  urlState: ListUrlStateApi,
) {
  return {
    ...(filterFacets.length > 0 && {
      filterFacets,
      onFilterChange: routeFacetChange(urlState),
    }),
    ...(dateRangeFacets.length > 0 && {
      dateRangeFacets,
      onDateRangeChange,
    }),
  };
}

export function projectionFilterStateProps(
  filterFacets: ReturnType<typeof useProjectionListData>["filterFacets"],
  dateRangeFacets: ReturnType<typeof useProjectionListQuery>["dateRangeFacets"],
  urlState: ListUrlStateApi,
  activeNamedFilter: string | undefined,
) {
  return {
    ...((filterFacets.length > 0 || dateRangeFacets.length > 0) && {
      filterValues: withNamedFilterValues(urlState.filters, activeNamedFilter),
      onFilterReset: urlState.clearFilters,
    }),
  };
}
