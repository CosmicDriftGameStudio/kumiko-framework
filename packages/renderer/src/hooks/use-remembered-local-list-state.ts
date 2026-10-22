import { type Dispatch, type SetStateAction, useCallback, useEffect, useState } from "react";
import type { ListStateStore } from "../components/list-state-store.tsx";
import { type KnownListFields, sanitizeStoredListState } from "./list-state-schema.ts";
import type { ListSort } from "./use-list-url-state.ts";

type LocalFilters = Readonly<Record<string, readonly string[]>>;

type LocalListState = {
  readonly search: string;
  readonly filters: LocalFilters;
  readonly sort: ListSort | null;
};

const FILTER_PREFIX = "f.";

function sameSort(a: ListSort | null, b: ListSort | null): boolean {
  return a === b || (a !== null && b !== null && a.field === b.field && a.dir === b.dir);
}

function toParams(state: LocalListState, defaultSort: ListSort | null): Record<string, string> {
  const params: Record<string, string> = {};
  if (state.search !== "") params["q"] = state.search;
  if (!sameSort(state.sort, defaultSort) && state.sort !== null) {
    params["sort"] = state.sort.field;
    params["dir"] = state.sort.dir;
  }
  for (const [field, values] of Object.entries(state.filters)) {
    if (values.length > 0) params[`${FILTER_PREFIX}${field}`] = values.join(",");
  }
  return params;
}

function fromParams(
  params: Readonly<Record<string, string>> | undefined,
  defaultSort: ListSort | null,
): LocalListState {
  const sortField = params?.["sort"];
  const dir = params?.["dir"];
  const sort: ListSort | null =
    sortField !== undefined && (dir === "asc" || dir === "desc")
      ? { field: sortField, dir }
      : defaultSort;
  const filters: Record<string, readonly string[]> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    if (key.startsWith(FILTER_PREFIX)) {
      filters[key.slice(FILTER_PREFIX.length)] = value.split(",").filter((v) => v !== "");
    }
  }
  return { search: params?.["q"] ?? "", filters, sort };
}

type LocalListStateArgs = {
  readonly storeKey: string;
  readonly store: ListStateStore;
  /** `table.rememberState`: seeds from the store and writes every change back. */
  readonly remember: boolean;
  readonly defaultSort: ListSort | null;
  readonly known: KnownListFields;
};

/** Search, facet filters and sort of a list whose state is component-local
 *  (relatedList has no URL namespace). Same stored `params` format as the URL lists. */
export function useRememberedLocalListState({
  storeKey,
  store,
  remember,
  defaultSort,
  known,
}: LocalListStateArgs) {
  const [state, setState] = useState<LocalListState>(() =>
    remember
      ? fromParams(sanitizeStoredListState(store.read(storeKey), known)?.params, defaultSort)
      : { search: "", filters: {}, sort: defaultSort },
  );

  useEffect(() => {
    // skip: remembering is not enabled
    if (!remember) return;
    const params = toParams(state, defaultSort);
    const existing = store.read(storeKey);
    // skip: nothing stored and nothing to store
    if (existing?.params === undefined && Object.keys(params).length === 0) return;
    store.write(storeKey, { ...existing, params });
  }, [remember, state, defaultSort, store, storeKey]);

  const setSearch = useCallback((search: string) => setState((prev) => ({ ...prev, search })), []);
  const setFilters: Dispatch<SetStateAction<LocalFilters>> = useCallback(
    (next) =>
      setState((prev) => ({
        ...prev,
        filters: typeof next === "function" ? next(prev.filters) : next,
      })),
    [],
  );
  const setSort = useCallback(
    (sort: ListSort | null) => setState((prev) => ({ ...prev, sort })),
    [],
  );
  const reset = useCallback(
    () => setState({ search: "", filters: {}, sort: defaultSort }),
    [defaultSort],
  );

  const atDefault =
    state.search === "" &&
    Object.values(state.filters).every((values) => values.length === 0) &&
    sameSort(state.sort, defaultSort);

  return { ...state, setSearch, setFilters, setSort, reset, atDefault };
}
