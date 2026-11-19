import type {
  EntityDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { useCallback, useMemo, useState } from "react";
import type { FacetValueCountQuery } from "./facet-count-bridge.tsx";
import type { FacetValueCounts } from "./facet-value-counts.ts";
import { buildFilterPayload, countedFacetFields, type ResolvedFacetSpec } from "./list-facets.ts";
import type { RangeFilter } from "./use-entity-range-facets.ts";

export function useEntityFacetValueCounts(args: {
  readonly specs: readonly ResolvedFacetSpec[];
  readonly facets: EntityListScreenDefinition["facets"];
  readonly urlFilters: Readonly<Record<string, readonly string[]>>;
  readonly search: string;
  readonly screenFilter: EntityListScreenDefinition["filter"];
  readonly fields: EntityDefinition["fields"];
  readonly rangeFilters: readonly RangeFilter[];
  readonly activeNamedFilter: string | undefined;
}): {
  readonly valueCountQueries: FacetValueCountQuery[];
  readonly facetValueCounts: Readonly<Record<string, FacetValueCounts>>;
  readonly handleFacetValueCounts: (field: string, counts: FacetValueCounts | undefined) => void;
} {
  const {
    specs,
    facets,
    urlFilters,
    search,
    screenFilter,
    fields,
    rangeFilters,
    activeNamedFilter,
  } = args;
  const valueCountQueries = useMemo<FacetValueCountQuery[]>(
    () =>
      countedFacetFields(specs, facets).map((field) => {
        const otherFilters = Object.fromEntries(
          Object.entries(urlFilters).filter(([name]) => name !== field),
        );
        const filters = [
          ...buildFilterPayload(otherFilters, (name) => fields[name]?.type),
          ...rangeFilters,
        ];
        return {
          field,
          payload: {
            aggregate: { groupBy: field, measures: [] },
            ...(search !== "" && { search }),
            ...(screenFilter !== undefined && { filter: screenFilter }),
            ...(filters.length > 0 && { filters }),
            ...(activeNamedFilter !== undefined && { namedFilter: activeNamedFilter }),
          },
        };
      }),
    [specs, facets, urlFilters, search, screenFilter, fields, rangeFilters, activeNamedFilter],
  );
  const [facetValueCounts, setFacetValueCounts] = useState<Record<string, FacetValueCounts>>({});
  const handleFacetValueCounts = useCallback(
    (field: string, counts: FacetValueCounts | undefined) =>
      setFacetValueCounts((prev) => {
        if (counts === undefined) {
          if (!Object.hasOwn(prev, field)) return prev;
          const { [field]: _removed, ...rest } = prev;
          return rest;
        }
        return prev[field] === counts ? prev : { ...prev, [field]: counts };
      }),
    [],
  );
  return { valueCountQueries, facetValueCounts, handleFacetValueCounts };
}
