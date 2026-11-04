import type { EntityListScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { useMemo } from "react";
import type { Translate } from "../headless/index.ts";
import type { ListUrlStateApi } from "../hooks/use-list-url-state.ts";
import type { FacetCountQuery } from "./facet-count-bridge.tsx";
import { buildNamedFilterCountQueries, buildNamedFilterEmpty } from "./named-filter-facet.ts";
import type { RangeFilter } from "./use-entity-range-facets.ts";

/** The count requests and the empty text an entityList derives from its named filters. */
export function useNamedFilterQueue({
  screen,
  urlState,
  userRoles,
  translate,
  filterPayload,
  rangeFilters,
  activeNamedFilter,
  listPayloadFor,
}: {
  readonly screen: EntityListScreenDefinition;
  readonly urlState: ListUrlStateApi;
  readonly userRoles: readonly string[] | undefined;
  readonly translate: Translate;
  readonly filterPayload: readonly unknown[];
  readonly rangeFilters: readonly RangeFilter[];
  readonly activeNamedFilter: string | undefined;
  readonly listPayloadFor: (namedFilter: string | undefined) => Readonly<Record<string, unknown>>;
}): {
  readonly namedFilterCountQueries: FacetCountQuery[];
  readonly namedFilterEmpty: ReturnType<typeof buildNamedFilterEmpty>;
} {
  const otherNarrowing = filterPayload.length + rangeFilters.length > 0;
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
  const namedFilterEmpty = buildNamedFilterEmpty(
    screen.namedFilters,
    activeNamedFilter,
    urlState.q,
    otherNarrowing,
    translate,
    () => urlState.setNamedFilter(undefined),
  );
  return { namedFilterCountQueries, namedFilterEmpty };
}
