import type { ProjectionListScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { useCallback, useMemo } from "react";
import type { Translate } from "../headless/index.ts";
import type { ListUrlStateApi } from "../hooks/use-list-url-state.ts";
import { useOptionalTimeZone } from "../i18n.tsx";
import type { DataTableDateRangeFacet } from "../primitives.tsx";
import {
  buildDateRangePayload,
  clampDateRange,
  readDateRange,
  resolveDateRangeFacets,
} from "./list-facets.ts";

/** dateRange facets bypass `filters` entirely: their two bounds become the
 *  top-level query params the facet declares, resolved from a calendar date
 *  to an instant in the viewer's zone. */
export function useProjectionDateRange(
  facets: ProjectionListScreenDefinition["facets"],
  translate: Translate,
  urlState: ListUrlStateApi,
) {
  const timeZone = useOptionalTimeZone();
  const dateRangeSpecs = useMemo(
    () => resolveDateRangeFacets(facets, translate),
    [facets, translate],
  );
  const dateRangePayload = useMemo(
    () => buildDateRangePayload(dateRangeSpecs, urlState.filters, timeZone),
    [dateRangeSpecs, urlState.filters, timeZone],
  );
  const dateRangeFacets = useMemo<DataTableDateRangeFacet[]>(
    () =>
      dateRangeSpecs.map((spec) => ({
        field: spec.field,
        label: spec.label,
        ...readDateRange(urlState.filters, spec.field),
      })),
    [dateRangeSpecs, urlState.filters],
  );
  const { setDateRange, filters } = urlState;
  const handleDateRangeChange = useCallback(
    (field: string, bound: "from" | "to", value: string) => {
      setDateRange(field, clampDateRange(readDateRange(filters, field), bound, value));
    },
    [setDateRange, filters],
  );
  return { dateRangePayload, dateRangeFacets, handleDateRangeChange };
}
