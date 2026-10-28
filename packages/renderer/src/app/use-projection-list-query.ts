import type { ProjectionListScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { useCallback, useMemo, useState } from "react";
import type { Translate } from "../headless/index.ts";
import { type ListUrlStateApi, useListUrlState } from "../hooks/use-list-url-state.ts";
import {
  buildFilterPayload,
  mergeReferenceFacetOptions,
  resolveProjectionFacetSpecs,
} from "./list-facets.ts";
import type { synthesizeProjectionEntity } from "./projection-list-shim.ts";
import { type ReferenceFacetState, withReferenceFacetState } from "./reference-facet-bridge.tsx";
import { buildListQueryPayload } from "./screen-shared.tsx";
import { useProjectionDateRange } from "./use-projection-date-range.ts";

type ProjectionListQueryInput = {
  readonly screen: ProjectionListScreenDefinition;
  readonly featureName: string;
  readonly effectiveTranslate: Translate;
  readonly entity: ReturnType<typeof synthesizeProjectionEntity>;
  readonly searchable: boolean;
  readonly sortable: boolean;
  readonly paginated: boolean;
};

type ActiveSort = ListUrlStateApi["sort"];

// Same predicate that makes a header clickable: a stale link onto a
// sortable:false/unknown column must not reach the server (it answers 400).
function resolveActiveSort(
  urlSort: ActiveSort,
  input: Pick<ProjectionListQueryInput, "screen" | "entity" | "sortable">,
): ActiveSort {
  const { screen, entity, sortable } = input;
  const urlSortField = urlSort === null ? undefined : entity.fields[urlSort.field];
  const urlSortAllowed =
    urlSortField !== undefined && "sortable" in urlSortField && urlSortField.sortable === true;
  return sortable ? ((urlSortAllowed ? urlSort : null) ?? screen.defaultSort ?? null) : null;
}

export function useProjectionListQuery(input: ProjectionListQueryInput) {
  const { screen, featureName, effectiveTranslate, searchable, paginated } = input;
  const urlState = useListUrlState(screen.id);
  // Gated on the derived capability, not just on whether URL-state happens to
  // carry a value — a stale/hand-crafted URL (?…q=x on a non-searchable
  // screen) must not smuggle a param the query's Zod schema doesn't accept.
  const activeSearch = searchable ? urlState.q : "";
  const activeSort = resolveActiveSort(urlState.sort, input);
  const limit = urlState.pageSize ?? screen.pageSize ?? 50;
  // Pages-mode only (see header comment) — an author-set pagination:
  // "infinite" on a paginated projectionList is silently a no-op today.
  const usePager = paginated && (screen.pagination ?? "pages") === "pages";

  // Facets — a projectionList has no entity, so screen.facets is
  // the only field inventory; resolveProjectionFacetSpecs reshapes +
  // translates its explicit labels into the same ResolvedFacetSpec the
  // entityList adapter produces, so both feed the same
  // buildFilterFacets/buildFilterPayload.
  const facetSpecs = useMemo(
    () => resolveProjectionFacetSpecs(screen.facets, effectiveTranslate, featureName),
    [screen.facets, effectiveTranslate, featureName],
  );
  const [projectionReferenceFacetOptions, setProjectionReferenceFacetOptions] = useState<
    Record<string, ReferenceFacetState>
  >({});
  const handleProjectionFacetOptions = useCallback(
    (field: string, state: ReferenceFacetState) =>
      setProjectionReferenceFacetOptions((prev) => withReferenceFacetState(prev, field, state)),
    [],
  );
  const resolvedFacetSpecs = useMemo(
    () => mergeReferenceFacetOptions(facetSpecs, projectionReferenceFacetOptions),
    [facetSpecs, projectionReferenceFacetOptions],
  );
  const filterPayload = useMemo(
    () =>
      buildFilterPayload(
        urlState.filters,
        (field) => facetSpecs.find((spec) => spec.field === field)?.type,
      ),
    [urlState.filters, facetSpecs],
  );

  const { dateRangePayload, dateRangeFacets, handleDateRangeChange } = useProjectionDateRange(
    screen.facets,
    effectiveTranslate,
    urlState,
  );

  const queryPayload = useMemo(() => {
    const payload = buildListQueryPayload({
      limit,
      search: activeSearch,
      sort: activeSort,
      usePager,
      page: urlState.page,
      useInfinite: false,
      cursor: undefined,
    });
    // Gated on screen.filter/screen.facets being declared (not just on
    // urlState/filterPayload happening to carry a value) — same rule as
    // activeSearch/activeSort above: a stale URL must not smuggle a param
    // the bound query's Zod schema doesn't accept.
    if (screen.filter !== undefined) {
      payload["filter"] = screen.filter;
    }
    if (screen.facets !== undefined && filterPayload.length > 0) {
      payload["filters"] = filterPayload;
    }
    Object.assign(payload, dateRangePayload);
    return payload;
  }, [
    limit,
    activeSearch,
    activeSort,
    usePager,
    urlState.page,
    screen.filter,
    screen.facets,
    filterPayload,
    dateRangePayload,
  ]);

  return {
    urlState,
    activeSearch,
    activeSort,
    limit,
    usePager,
    facetSpecs,
    handleProjectionFacetOptions,
    resolvedFacetSpecs,
    dateRangeFacets,
    handleDateRangeChange,
    queryPayload,
  };
}
