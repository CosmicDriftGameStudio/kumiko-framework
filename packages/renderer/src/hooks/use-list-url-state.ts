// useListUrlState — combines an entityList's sort/dir/page/q into a
// per-screen-id namespaced URL state. The screen-ID prefix prevents two
// lists on the same route (e.g. a dashboard with Orders + Incidents)
// from competing over the same query keys.
//
// Parameter schema per list:
//   <screenId>.sort     — field name (string)
//   <screenId>.dir      — "asc" | "desc"
//   <screenId>.q        — search term (URL-encoded)
//   <screenId>.page     — 1-based page number (only for pagination="pages")
//   <screenId>.f.<field> — faceted filter: comma-joined selected values;
//                          NO_FILTER_URL_VALUE = "no filter", chosen deliberately
//                          for a field that has a declared default
//
// Uses setSearchParams (replaceState, not push) so sort/filter toggles do not
// flood the browser history.

import { useCallback, useMemo } from "react";
import { useNav } from "../app/nav.tsx";
import type { DataTableSort, DataTableSortDir } from "../primitives.tsx";

// A facet with a `defaultFilters` entry falls back to that default whenever
// its URL key is absent. Clearing it therefore has to leave a marker, or the
// default would come straight back.
export const NO_FILTER_URL_VALUE = "~";

// ListSort and DataTableSort had the same shape and could drift apart,
// so this aliases the primitives type to keep one source of truth and avoid
// a cast in RenderList.
export type ListSortDir = DataTableSortDir;
export type ListSort = DataTableSort;

export type ListUrlState = {
  /** Active sort (or null for unsorted; the server supplies the default order). */
  readonly sort: ListSort | null;
  /** Search term (empty when unset). */
  readonly q: string;
  /** 1-based page number. For pagination="infinite" or false, this value is
   * ignored; callers read it only when relevant. */
  readonly page: number;
  /** User-chosen page size from `PAGE_SIZE_OPTIONS`; undefined = screen default. */
  readonly pageSize: number | undefined;
  /** Active faceted filters: field → selected values (strings; callers coerce
   * them according to the field type). Empty when no filter is set. */
  readonly filters: Readonly<Record<string, readonly string[]>>;
};

export type ListUrlStateApi = ListUrlState & {
  /** Atomically sets sort + dir. null means unsorted and clears both keys. */
  readonly setSort: (next: ListSort | null) => void;
  /** Sets the search term. An empty string clears the key. Callers must debounce
   * this themselves (e.g. with useDebouncedCallback in the search input component). */
  readonly setQ: (next: string) => void;
  /** Sets the page. 1 or less clears the key and restores the default page. */
  readonly setPage: (next: number) => void;
  /** Sets the page size and resets the page; undefined clears the key. */
  readonly setPageSize: (next: number | undefined) => void;
  /** Sets the selected values for a facet field. An empty array clears the key
   * and resets the page, like sort/search changes. */
  readonly setFilter: (field: string, values: readonly string[]) => void;
  /** Clears all active faceted filters (for a reset button). */
  readonly clearFilters: () => void;
  /** Sets both bounds of a dateRange facet in ONE params update — two
   *  setFilter calls would overwrite each other, since the second still sees
   *  the old searchParams. An empty string clears that bound. Resets the page
   *  like setFilter. */
  readonly setDateRange: (
    field: string,
    next: { readonly from: string; readonly to: string },
  ) => void;
};

// `.` is used as a separator because it is readable (`?orders.sort=name`)
// and does not conflict with conventional field names (kebab- or camelCase
// without dots). The boot validator requires screen.id to contain no dots;
// see the boot-validator entityList section.
export const PAGE_SIZE_OPTIONS: readonly number[] = [25, 50, 100];

function parsePageSize(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseInt(value, 10);
  return PAGE_SIZE_OPTIONS.includes(n) ? n : undefined;
}

function key(screenId: string, suffix: string): string {
  return `${screenId}.${suffix}`;
}

/** URL key of a list facet filter. Its value is the comma-joined selected values. */
export function listFilterUrlKey(screenId: string, field: string): string {
  return key(screenId, `f.${field}`);
}

function parseDir(value: string | undefined): ListSortDir | undefined {
  return value === "asc" || value === "desc" ? value : undefined;
}

function parsePage(value: string | undefined): number {
  if (value === undefined) return 1;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function useListUrlState(
  screenId: string,
  defaultFilters?: Readonly<Record<string, readonly string[]>>,
): ListUrlStateApi {
  const nav = useNav();
  const params = nav.searchParams;

  const sort = useMemo<ListSort | null>(() => {
    const field = params[key(screenId, "sort")];
    const dir = parseDir(params[key(screenId, "dir")]);
    if (field === undefined || field === "" || dir === undefined) return null;
    return { field, dir };
  }, [params, screenId]);

  const q = params[key(screenId, "q")] ?? "";
  const page = parsePage(params[key(screenId, "page")]);
  const pageSize = parsePageSize(params[key(screenId, "size")]);

  const filterPrefix = listFilterUrlKey(screenId, "");
  const filters = useMemo<Readonly<Record<string, readonly string[]>>>(() => {
    const out: Record<string, readonly string[]> = {};
    for (const [k, v] of Object.entries(params)) {
      if (!k.startsWith(filterPrefix) || v === "") continue;
      const field = k.slice(filterPrefix.length);
      if (field === "") continue;
      // ponytail: comma-join — facet values are select options/booleans without
      // commas; use repeated keys if comma-containing values are ever needed.
      out[field] = v === NO_FILTER_URL_VALUE ? [] : v.split(",").filter((s) => s !== "");
    }
    for (const [field, values] of Object.entries(defaultFilters ?? {})) {
      if (!Object.hasOwn(out, field)) out[field] = values;
    }
    return out;
  }, [params, filterPrefix, defaultFilters]);

  const clearedFilterValue = useCallback(
    (field: string): string | null =>
      defaultFilters !== undefined && Object.hasOwn(defaultFilters, field)
        ? NO_FILTER_URL_VALUE
        : null,
    [defaultFilters],
  );

  const setSort = useCallback(
    (next: ListSort | null) => {
      // Atomically reset the page on every sort change; otherwise the user could
      // land on page 5 of the old ordering, which is visually confusing. The
      // page reset also applies when next is null for the same reason.
      nav.setSearchParams({
        [key(screenId, "sort")]: next === null ? null : next.field,
        [key(screenId, "dir")]: next === null ? null : next.dir,
        [key(screenId, "page")]: null,
      });
    },
    [nav, screenId],
  );

  const setQ = useCallback(
    (next: string) => {
      // A search change resets the page but preserves the sort, so users can search
      // while keeping the active ordering.
      nav.setSearchParams({
        [key(screenId, "q")]: next === "" ? null : next,
        [key(screenId, "page")]: null,
      });
    },
    [nav, screenId],
  );

  const setPage = useCallback(
    (next: number) => {
      nav.setSearchParams({
        [key(screenId, "page")]: next <= 1 ? null : String(next),
      });
    },
    [nav, screenId],
  );

  const setPageSize = useCallback(
    (next: number | undefined) => {
      nav.setSearchParams({
        [key(screenId, "size")]: next === undefined ? null : String(next),
        [key(screenId, "page")]: null,
      });
    },
    [nav, screenId],
  );

  const setFilter = useCallback(
    (field: string, values: readonly string[]) => {
      nav.setSearchParams({
        [listFilterUrlKey(screenId, field)]:
          values.length === 0 ? clearedFilterValue(field) : values.join(","),
        [key(screenId, "page")]: null,
      });
    },
    [nav, screenId, clearedFilterValue],
  );

  const setDateRange = useCallback(
    (field: string, next: { readonly from: string; readonly to: string }) => {
      nav.setSearchParams({
        [key(screenId, `f.${field}.from`)]: next.from === "" ? null : next.from,
        [key(screenId, `f.${field}.to`)]: next.to === "" ? null : next.to,
        [key(screenId, "page")]: null,
      });
    },
    [nav, screenId],
  );

  const clearFilters = useCallback(() => {
    const updates: Record<string, string | null> = { [key(screenId, "page")]: null };
    for (const field of Object.keys(filters)) {
      updates[key(screenId, `f.${field}`)] = clearedFilterValue(field);
    }
    nav.setSearchParams(updates);
  }, [nav, screenId, filters, clearedFilterValue]);

  return {
    sort,
    q,
    page,
    pageSize,
    filters,
    setSort,
    setQ,
    setPage,
    setPageSize,
    setFilter,
    clearFilters,
    setDateRange,
  };
}
