import type {
  NamedFilterFacetOptions,
  NamedListFilterRef,
} from "@cosmicdrift/kumiko-types/named-list-filters";
import type { NamedFilterEmptyContent } from "../components/list-empty-state.tsx";
import type { Translate } from "../headless/index.ts";
import type { ListUrlStateApi } from "../hooks/use-list-url-state.ts";
import type { DataTableFacet } from "../primitives.tsx";
import type { FacetCountQuery } from "./facet-count-bridge.tsx";

// Not a real field: keeps the named filter out of the `.f.<field>` facet namespace.
export const NAMED_FILTER_FACET_FIELD = "__namedFilter";

const NAMED_FILTER_ALL_CHIP_ID = "all";

type NamedFilterUrlState = Pick<ListUrlStateApi, "namedFilter" | "setFilter" | "setNamedFilter">;

// Unknown roles (undefined) deny a restricted filter, like role-gated screens do.
export function isNamedFilterOffered(
  ref: NamedListFilterRef,
  userRoles: readonly string[] | undefined,
): boolean {
  const required = ref.roles;
  return required === undefined || (userRoles ?? []).some((role) => required.includes(role));
}

// `undefined` is the "all" entry: the list without any named filter.
export function namedFilterCountKey(id: string | undefined): string {
  return `${NAMED_FILTER_FACET_FIELD}:${id ?? ""}`;
}

function offeredRefs(
  allRefs: readonly NamedListFilterRef[] | undefined,
  userRoles: readonly string[] | undefined,
): readonly NamedListFilterRef[] {
  return allRefs?.filter((ref) => isNamedFilterOffered(ref, userRoles)) ?? [];
}

/** One toggle chip (or one select entry) per named filter the user may open, rendered by the facet row. */
export function buildNamedFilterFacet(
  allRefs: readonly NamedListFilterRef[] | undefined,
  translate: Translate,
  userRoles: readonly string[] | undefined,
  options?: NamedFilterFacetOptions,
  counts: Readonly<Record<string, number>> = {},
): DataTableFacet | undefined {
  const refs = offeredRefs(allRefs, userRoles);
  if (refs.length === 0) return undefined;
  const isSelect = options?.display === "select";
  const showCounts = options?.showCounts === true;
  const hideEmpty = options?.hideEmpty === true;
  const countOf = (id: string | undefined): { count?: number } => {
    const count = showCounts || hideEmpty ? counts[namedFilterCountKey(id)] : undefined;
    return count === undefined ? {} : { count };
  };
  const chips = refs.map((ref) => ({
    id: ref.id,
    label: translate(ref.label),
    values: [ref.id],
    ...(ref.separatorAfter === true && { separatorAfter: true }),
    ...countOf(ref.id),
  }));
  return {
    field: NAMED_FILTER_FACET_FIELD,
    label:
      options?.label !== undefined
        ? translate(options.label)
        : refs.map((ref) => translate(ref.label)).join(" / "),
    options: refs.map((ref) => ({ value: ref.id, label: translate(ref.label) })),
    chips: isSelect
      ? [
          {
            id: NAMED_FILTER_ALL_CHIP_ID,
            label: translate("kumiko.list.named-filter.all"),
            values: [],
            ...countOf(undefined),
          },
          ...chips,
        ]
      : chips,
    ...(isSelect && { display: "select" as const }),
    ...(options?.narrowPlacement !== undefined && { narrowPlacement: options.narrowPlacement }),
    ...(showCounts && { showCounts: true }),
    ...(hideEmpty && { hideEmpty: true }),
  };
}

/** The list payload of one named filter reduced to a count: no sort and no paging, one row, the total. */
export function namedFilterCountPayload(
  listPayload: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...listPayload, limit: 1, totalCount: true };
  for (const pagingOrSortKey of ["sort", "sortDirection", "offset", "cursor"]) {
    delete payload[pagingOrSortKey];
  }
  return payload;
}

/** One count query per offered filter plus one for "all"; each takes the very payload the list would send for that filter. */
export function buildNamedFilterCountQueries(
  allRefs: readonly NamedListFilterRef[] | undefined,
  userRoles: readonly string[] | undefined,
  options: NamedFilterFacetOptions | undefined,
  listPayloadFor: (namedFilter: string | undefined) => Readonly<Record<string, unknown>>,
): FacetCountQuery[] {
  if (options?.showCounts !== true && options?.hideEmpty !== true) return [];
  const refs = offeredRefs(allRefs, userRoles);
  if (refs.length === 0) return [];
  const ids: readonly (string | undefined)[] = [
    ...(options.display === "select" ? [undefined] : []),
    ...refs.map((ref) => ref.id),
  ];
  return ids.map((id) => ({
    key: namedFilterCountKey(id),
    payload: namedFilterCountPayload(listPayloadFor(id)),
  }));
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

/** The active filter's sort, unless the URL set one: ref.sort wins over the screen default. */
export function namedFilterSort(
  allRefs: readonly NamedListFilterRef[] | undefined,
  activeNamedFilter: string | undefined,
): NamedListFilterRef["sort"] {
  return allRefs?.find((ref) => ref.id === activeNamedFilter)?.sort;
}

/** URL sort, else the named filter's sort, else the screen default. */
export function resolveListSort(
  urlSort: ListUrlStateApi["sort"],
  allRefs: readonly NamedListFilterRef[] | undefined,
  namedFilter: string | undefined,
  defaultSort: ListUrlStateApi["sort"] | undefined,
): ListUrlStateApi["sort"] {
  return urlSort ?? namedFilterSort(allRefs, namedFilter) ?? defaultSort ?? null;
}

/** Only while the filter alone explains the empty list: a search term or another narrowing would make the sentence wrong. */
export function buildNamedFilterEmpty(
  allRefs: readonly NamedListFilterRef[] | undefined,
  activeNamedFilter: string | undefined,
  search: string,
  otherNarrowing: boolean,
  translate: Translate,
  onReset: () => void,
): NamedFilterEmptyContent | undefined {
  const emptyState = allRefs?.find((ref) => ref.id === activeNamedFilter)?.emptyState;
  if (emptyState === undefined || otherNarrowing || search.trim() !== "") return undefined;
  const { title, description, paramsQuery } = emptyState;
  return {
    title: translate(title),
    ...(description !== undefined &&
      (paramsQuery === undefined
        ? { description: translate(description) }
        : {
            describedByQuery: {
              query: paramsQuery,
              describe: (params: Readonly<Record<string, unknown>>) =>
                translate(description, params),
            },
          })),
    onReset,
  };
}
