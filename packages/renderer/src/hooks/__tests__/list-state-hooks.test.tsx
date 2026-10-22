import { describe, expect, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { createMemoryListStateStore } from "../../components/list-state-store.tsx";
import { useListViewState } from "../use-list-view-state.ts";
import { useRememberedLocalListState } from "../use-remembered-local-list-state.ts";

const schemaColumns = [{ field: "name" }, { field: "city", hidden: true }, { field: "age" }];
const known = { columnFields: ["name", "city", "age"], filterFields: ["status"] };

describe("useListViewState", () => {
  test("columns marked hidden start hidden, a choice is remembered and survives a remount", () => {
    const store = createMemoryListStateStore();
    const args = {
      storeKey: "orders",
      store,
      table: { columnPicker: true, density: { userChoice: true } },
      schemaColumns,
    };
    const first = renderHook(() => useListViewState(args));
    expect(first.result.current.columns?.map((c) => c.visible)).toEqual([true, false, true]);
    expect(first.result.current.viewIsDefault).toBe(true);

    act(() => first.result.current.setDensity("compact"));
    act(() =>
      first.result.current.setColumns([
        { field: "age", visible: true },
        { field: "city", visible: true },
        { field: "name", visible: true },
      ]),
    );
    first.unmount();

    const second = renderHook(() => useListViewState(args));
    expect(second.result.current.density).toBe("compact");
    expect(second.result.current.columns?.map((c) => c.field)).toEqual(["age", "city", "name"]);
    expect(second.result.current.viewIsDefault).toBe(false);

    act(() => second.result.current.resetView());
    expect(second.result.current.viewIsDefault).toBe(true);
    expect(store.read("orders")?.view).toBeUndefined();
  });

  test("the last visible column cannot be hidden", () => {
    const store = createMemoryListStateStore();
    const { result } = renderHook(() =>
      useListViewState({ storeKey: "k", store, table: { columnPicker: true }, schemaColumns }),
    );
    act(() =>
      result.current.setColumns([
        { field: "name", visible: false },
        { field: "city", visible: false },
        { field: "age", visible: false },
      ]),
    );
    expect(result.current.columns?.some((c) => c.visible)).toBe(true);
  });

  test("a table without the options writes nothing to the store", () => {
    const store = createMemoryListStateStore();
    renderHook(() => useListViewState({ storeKey: "k", store, table: {}, schemaColumns }));
    expect(store.read("k")).toBeUndefined();
  });
});

describe("useRememberedLocalListState", () => {
  const defaultSort = { field: "name", dir: "asc" as const };

  test("remembers search, filters and sort and restores them for the next mount", () => {
    const store = createMemoryListStateStore();
    const args = { storeKey: "p#rel", store, remember: true, defaultSort, known };
    const first = renderHook(() => useRememberedLocalListState(args));
    expect(first.result.current.atDefault).toBe(true);
    act(() => first.result.current.setSearch("acme"));
    act(() => first.result.current.setFilters({ status: ["open"] }));
    act(() => first.result.current.setSort({ field: "age", dir: "desc" }));
    first.unmount();

    const second = renderHook(() => useRememberedLocalListState(args));
    expect(second.result.current.search).toBe("acme");
    expect(second.result.current.filters).toEqual({ status: ["open"] });
    expect(second.result.current.sort).toEqual({ field: "age", dir: "desc" });
    expect(second.result.current.atDefault).toBe(false);

    act(() => second.result.current.reset());
    expect(second.result.current.atDefault).toBe(true);
    expect(second.result.current.sort).toEqual(defaultSort);
  });

  test("without rememberState the store is never touched", () => {
    const store = createMemoryListStateStore();
    const { result } = renderHook(() =>
      useRememberedLocalListState({ storeKey: "k", store, remember: false, defaultSort, known }),
    );
    act(() => result.current.setSearch("acme"));
    expect(store.read("k")).toBeUndefined();
  });
});
