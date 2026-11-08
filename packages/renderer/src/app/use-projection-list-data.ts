import type { ProjectionListScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { useCallback, useMemo, useState } from "react";
import { useUserRoles } from "../context/user-roles-context.tsx";
import type { Translate } from "../headless/index.ts";
import type { DataTableFacet } from "../primitives.tsx";
import { buildFilterFacets, type ResolvedFacetSpec } from "./list-facets.ts";
import { buildNamedFilterCountQueries, buildNamedFilterFacet } from "./named-filter-facet.ts";
import { useFacetCounts } from "./use-facet-counts.ts";
import { useScreenListRows } from "./use-screen-list-rows.ts";
import { useScreenListTable } from "./use-screen-list-table.ts";

type ProjectionListDataInput = {
  readonly screen: ProjectionListScreenDefinition;
  readonly featureName: string;
  readonly queryPayload: Parameters<typeof useScreenListRows>[0]["payload"];
  readonly limit: number;
  readonly usePager: boolean;
  readonly effectiveTranslate: Translate;
  readonly resolvedFacetSpecs: readonly ResolvedFacetSpec[];
  readonly listPayloadFor: (namedFilter: string | undefined) => Readonly<Record<string, unknown>>;
};

export function useProjectionListData(input: ProjectionListDataInput) {
  const {
    screen,
    featureName,
    queryPayload,
    limit,
    usePager,
    effectiveTranslate,
    resolvedFacetSpecs,
    listPayloadFor,
  } = input;
  const userRoles = useUserRoles();
  const facetFilterFields = useMemo(
    () => (screen.facets ?? []).map((facet) => facet.field),
    [screen.facets],
  );
  const listTable = useScreenListTable({
    screen,
    featureName,
    payload: queryPayload,
    filterFields: facetFilterFields,
    queryType: screen.query,
    pageSize: limit,
    paging: usePager ? "offset" : "cursor",
    translate: effectiveTranslate,
  });
  const listRows = useScreenListRows({
    queryType: screen.query,
    payload: queryPayload,
    infinite: false,
    aggregates: listTable.aggregates,
    rowDecoration: screen.rowDecoration,
    restoring: listTable.restoring,
  });

  // Counts come from their own queries, which a write leaves untouched.
  const [countRefreshNonce, setCountRefreshNonce] = useState(0);
  const { refreshAfterWrite: refreshListAfterWrite } = listRows;
  const refreshAfterWrite = useCallback(async () => {
    setCountRefreshNonce((n) => n + 1);
    await refreshListAfterWrite();
  }, [refreshListAfterWrite]);
  const { facetCounts, handleFacetCount } = useFacetCounts();
  const namedFilterCountQueries = useMemo(
    () =>
      buildNamedFilterCountQueries(
        screen.namedFilters,
        userRoles,
        screen.namedFilterFacet,
        listPayloadFor,
      ),
    [screen.namedFilters, screen.namedFilterFacet, userRoles, listPayloadFor],
  );

  const filterFacets = useMemo<DataTableFacet[]>(() => {
    const namedFacet = buildNamedFilterFacet(
      screen.namedFilters,
      effectiveTranslate,
      userRoles,
      screen.namedFilterFacet,
      facetCounts,
    );
    return [
      ...buildFilterFacets(resolvedFacetSpecs),
      ...(namedFacet !== undefined ? [namedFacet] : []),
    ];
  }, [
    resolvedFacetSpecs,
    screen.namedFilters,
    screen.namedFilterFacet,
    effectiveTranslate,
    userRoles,
    facetCounts,
  ]);
  return {
    listTable,
    listRows,
    filterFacets,
    refreshAfterWrite,
    namedFilterCountQueries,
    handleFacetCount,
    countRefreshNonce,
  };
}
