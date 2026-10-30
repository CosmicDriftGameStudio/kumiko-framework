import type { NamedListFilterRef } from "@cosmicdrift/kumiko-types/named-list-filters";
import type { Translate } from "../headless/index.ts";
import type { ListUrlStateApi } from "../hooks/use-list-url-state.ts";
import type { DataTableFacet } from "../primitives.tsx";

// Not a real field: keeps the named filter out of the `.f.<field>` facet namespace.
export const NAMED_FILTER_FACET_FIELD = "__namedFilter";

type NamedFilterUrlState = Pick<ListUrlStateApi, "namedFilter" | "setFilter" | "setNamedFilter">;

/** One toggle chip per named filter, rendered by the existing facet chip row. */
export function buildNamedFilterFacet(
  refs: readonly NamedListFilterRef[] | undefined,
  translate: Translate,
): DataTableFacet | undefined {
  if (refs === undefined || refs.length === 0) return undefined;
  return {
    field: NAMED_FILTER_FACET_FIELD,
    label: refs.map((ref) => translate(ref.label)).join(" / "),
    options: refs.map((ref) => ({ value: ref.id, label: translate(ref.label) })),
    chips: refs.map((ref) => ({ id: ref.id, label: translate(ref.label), values: [ref.id] })),
  };
}

export function withNamedFilterValues(
  filters: Readonly<Record<string, readonly string[]>>,
  namedFilter: string | undefined,
): Readonly<Record<string, readonly string[]>> {
  return namedFilter === undefined
    ? filters
    : { ...filters, [NAMED_FILTER_FACET_FIELD]: [namedFilter] };
}

/** Pressing the active chip again removes it. */
export function routeFacetChange(
  urlState: NamedFilterUrlState,
): (field: string, values: readonly string[]) => void {
  return (field, values) => {
    if (field !== NAMED_FILTER_FACET_FIELD) {
      urlState.setFilter(field, values);
      // skip: ordinary facet handled above
      return;
    }
    const picked = values[0];
    urlState.setNamedFilter(picked === urlState.namedFilter ? undefined : picked);
  };
}
