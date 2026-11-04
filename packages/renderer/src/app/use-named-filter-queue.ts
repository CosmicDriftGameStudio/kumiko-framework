import type { EntityListScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { useMemo } from "react";
import type { Translate } from "../headless/index.ts";
import type { ListUrlStateApi } from "../hooks/use-list-url-state.ts";
import type { FacetCountQuery } from "./facet-count-bridge.tsx";
import {
  buildNamedFilterCountQueries,
  buildNamedFilterEmpty,
  namedFilterSort,
} from "./named-filter-facet.ts";
import type { RangeFilter } from "./use-entity-range-facets.ts";

/** Everything an entityList derives from its named filters: the sort that applies, the count requests and the empty text. */
export function useNamedFilterQueue({
  screen,
  urlState,
  userRoles,
  translate,
  filterPayload,
  rangeFilters,
  activeNamedFilter,
}: {
  readonly screen: EntityListScreenDefinition;
  readonly urlState: ListUrlStateApi;
  readonly userRoles: readonly string[] | undefined;
  readonly translate: Translate;
  readonly filterPayload: readonly unknown[];
  readonly rangeFilters: readonly RangeFilter[];
  readonly activeNamedFilter: string | undefined;
}): {
  readonly effectiveSort: ListUrlStateApi["sort"];
  readonly namedFilterCountQueries: FacetCountQuery[];
  readonly namedFilterEmpty: ReturnType<typeof buildNamedFilterEmpty>;
} {
  const effectiveSort =
    urlState.sort ??
    namedFilterSort(screen.namedFilters, activeNamedFilter) ??
    screen.defaultSort ??
    null;
  const otherNarrowing = filterPayload.length + rangeFilters.length > 0;
  const namedFilterCountQueries = useMemo(
    () =>
      buildNamedFilterCountQueries(screen.namedFilters, userRoles, screen.namedFilterFacet, {
        limit: 1,
        totalCount: true,
        ...(urlState.q !== "" && { search: urlState.q }),
        ...(screen.filter !== undefined && { filter: screen.filter }),
        ...(otherNarrowing && { filters: [...filterPayload, ...rangeFilters] }),
      }),
    [
      screen.namedFilters,
      screen.namedFilterFacet,
      screen.filter,
      userRoles,
      urlState.q,
      filterPayload,
      rangeFilters,
      otherNarrowing,
    ],
  );
  const namedFilterEmpty = buildNamedFilterEmpty(
    screen.namedFilters,
    activeNamedFilter,
    urlState.q,
    otherNarrowing,
    translate,
    () => urlState.setNamedFilter(undefined),
  );
  return { effectiveSort, namedFilterCountQueries, namedFilterEmpty };
}
