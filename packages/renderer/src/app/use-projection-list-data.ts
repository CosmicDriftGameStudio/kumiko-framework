import type { ProjectionListScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { useMemo } from "react";
import type { Translate } from "../headless/index.ts";
import type { DataTableFacet } from "../primitives.tsx";
import { buildFilterFacets, type ResolvedFacetSpec } from "./list-facets.ts";
import { buildNamedFilterFacet } from "./named-filter-facet.ts";
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
  } = input;
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
  });

  const filterFacets = useMemo<DataTableFacet[]>(() => {
    const namedFacet = buildNamedFilterFacet(screen.namedFilters, effectiveTranslate);
    return [
      ...(namedFacet !== undefined ? [namedFacet] : []),
      ...buildFilterFacets(resolvedFacetSpecs),
    ];
  }, [resolvedFacetSpecs, screen.namedFilters, effectiveTranslate]);
  return { listTable, listRows, filterFacets };
}
