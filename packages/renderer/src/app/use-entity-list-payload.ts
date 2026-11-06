import type {
  EntityDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { useCallback, useMemo } from "react";
import type { ListUrlStateApi } from "../hooks/use-list-url-state.ts";
import { buildFilterPayload } from "./list-facets.ts";
import { resolveListSort } from "./named-filter-facet.ts";
import { buildListQueryPayload } from "./screen-shared.tsx";
import type { RangeFilter } from "./use-entity-range-facets.ts";

type EntityListPayloadInput = {
  readonly screen: EntityListScreenDefinition;
  readonly entity: EntityDefinition;
  readonly urlState: ListUrlStateApi;
  readonly searchable: boolean;
  readonly rangeFilters: readonly RangeFilter[];
  readonly activeNamedFilter: string | undefined;
  readonly limit: number;
  readonly usePager: boolean;
  readonly useInfinite: boolean;
};

/** The list payload as a function of the named filter, so the list and every filter count share one path. */
export function useEntityListPayload({
  screen,
  entity,
  urlState,
  searchable,
  rangeFilters,
  activeNamedFilter,
  limit,
  usePager,
  useInfinite,
}: EntityListPayloadInput) {
  // typeOf reads the field type straight from entity.fields (not gated on
  // filterable, deliberately permissive; see the buildFilterPayload doc).
  const filterPayloadFor = useCallback(
    (filters: ListUrlStateApi["filters"]) =>
      buildFilterPayload(filters, (field) => {
        // entity.fields is weakly typed at the renderer layer (deserialized from
        // the schema); boundary cast like buildInitialValues.
        const type = propertyOf(entity.fields[field], "type");
        return typeof type === "string" ? type : undefined;
      }),
    [entity.fields],
  );
  const filterPayload = useMemo(
    () => filterPayloadFor(urlState.filters),
    [filterPayloadFor, urlState.filters],
  );
  const { filtersFor, sort: urlSort, page } = urlState;
  // A stale or hand-crafted ?q= on a non-searchable list must not reach the query.
  const q = searchable ? urlState.q : "";

  const listPayloadFor = useCallback(
    (namedFilter: string | undefined): Record<string, unknown> => {
      const payload = buildListQueryPayload({
        limit,
        search: q,
        sort: resolveListSort(urlSort, screen.namedFilters, namedFilter, screen.defaultSort),
        usePager,
        page,
        useInfinite,
        cursor: undefined,
      });
      // Screen filter (tier 2.7c), declared by the author on the schema and
      // independent of the user's q search. Several buckets of the same entity
      // ("Upcoming" / "Active" / "Past") use different filters with the same
      // query handler.
      if (screen.filter !== undefined) payload["filter"] = screen.filter;
      const filters = [...filterPayloadFor(filtersFor(namedFilter)), ...rangeFilters];
      if (filters.length > 0) payload["filters"] = filters;
      if (namedFilter !== undefined) payload["namedFilter"] = namedFilter;
      return payload;
    },
    [
      limit,
      q,
      urlSort,
      page,
      screen.namedFilters,
      screen.defaultSort,
      screen.filter,
      usePager,
      useInfinite,
      filtersFor,
      filterPayloadFor,
      rangeFilters,
    ],
  );
  const queryPayload = useMemo(
    () => listPayloadFor(activeNamedFilter),
    [listPayloadFor, activeNamedFilter],
  );
  const effectiveSort = resolveListSort(
    urlSort,
    screen.namedFilters,
    activeNamedFilter,
    screen.defaultSort,
  );
  return { filterPayload, listPayloadFor, queryPayload, effectiveSort };
}
