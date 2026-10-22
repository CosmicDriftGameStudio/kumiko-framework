import { describe, expect, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { createMemoryListStateStore } from "../../components/list-state-store.tsx";
import { MAX_COLUMN_WIDTH_PX } from "../list-column-layout.ts";
import { sanitizeStoredListState } from "../list-state-schema.ts";
import { type ListViewSchemaColumn, useListViewState } from "../use-list-view-state.ts";

const schemaColumns: readonly ListViewSchemaColumn[] = [
  { field: "name", pinned: "left", width: 240, minWidth: 120 },
  { field: "city" },
  { field: "age", width: 40 },
];
const known = { columnFields: ["name", "city", "age"], filterFields: [] };
const TABLE = { pinning: true, resizing: true, density: { userChoice: true } } as const;

function render(store = createMemoryListStateStore(), table: object = TABLE) {
  const args = { storeKey: "orders", store, table, schemaColumns };
  return { store, args, ...renderHook(() => useListViewState(args)) };
}

describe("useListViewState pinning and resizing", () => {
  test("a schema pin and the schema widths are the defaults, clamped to the minimum", () => {
    const { result } = render();
    expect(result.current.pins).toEqual({ name: "left" });
    expect(result.current.widths).toEqual({ name: 240, city: 160, age: 64 });
    expect(result.current.minWidths).toEqual({ name: 120, city: 64, age: 64 });
    expect(result.current.viewIsDefault).toBe(true);
  });

  test("pins and widths are undefined without the options", () => {
    const { result, store } = render(undefined, { density: { userChoice: true } });
    expect(result.current.pins).toBeUndefined();
    expect(result.current.widths).toBeUndefined();
    expect(result.current.minWidths).toBeUndefined();
    act(() => result.current.setDensity("compact"));
    expect(store.read("orders")?.view).toEqual({ density: "compact" });
  });

  test("a changed pin is remembered and survives a remount", () => {
    const first = render();
    act(() => first.result.current.setPins({ name: "left", age: "right" }));
    first.unmount();
    const second = render(first.store);
    expect(second.result.current.pins).toEqual({ name: "left", age: "right" });
    expect(second.result.current.viewIsDefault).toBe(false);
  });

  test("releasing a schema pin stays released after a remount", () => {
    const first = render();
    act(() => first.result.current.setPins({}));
    first.unmount();
    const second = render(first.store);
    expect(second.result.current.pins).toEqual({});
  });

  test("setWidth clamps to the column minimum, rounds and persists", () => {
    const first = render();
    act(() => first.result.current.setWidth("name", 30));
    expect(first.result.current.widths?.["name"]).toBe(120);
    act(() => first.result.current.setWidth("city", 211.6));
    expect(first.result.current.widths?.["city"]).toBe(212);
    first.unmount();
    const second = render(first.store);
    expect(second.result.current.widths).toEqual({ name: 120, city: 212, age: 64 });
  });

  test("setWidth and a stored width stop at the maximum", () => {
    const first = render();
    act(() => first.result.current.setWidth("city", 50_000));
    expect(first.result.current.widths?.["city"]).toBe(MAX_COLUMN_WIDTH_PX);
    first.store.write("orders", { view: { widths: { age: 9_999_999 } } });
    first.unmount();
    expect(render(first.store).result.current.widths?.["age"]).toBe(MAX_COLUMN_WIDTH_PX);
  });

  test("a density change keeps pins and widths", () => {
    const { result, store } = render();
    act(() => result.current.setPins({ city: "right" }));
    act(() => result.current.setWidth("city", 300));
    act(() => result.current.setDensity("compact"));
    expect(result.current.pins).toEqual({ city: "right" });
    expect(store.read("orders")?.view).toEqual({
      density: "compact",
      pins: { city: "right" },
      widths: { name: 240, city: 300, age: 64 },
    });
  });

  test("resetView restores the defaults", () => {
    const { result, store } = render();
    act(() => result.current.setPins({}));
    act(() => result.current.setWidth("city", 300));
    expect(result.current.viewIsDefault).toBe(false);
    act(() => result.current.resetView());
    expect(result.current.pins).toEqual({ name: "left" });
    expect(result.current.widths?.["city"]).toBe(160);
    expect(result.current.viewIsDefault).toBe(true);
    expect(store.read("orders")?.view).toBeUndefined();
  });
});

describe("sanitizeStoredListState pins and widths", () => {
  test("drops pins and widths of unknown columns", () => {
    const state = sanitizeStoredListState(
      { view: { pins: { name: "left", gone: "right" }, widths: { city: 200, gone: 90 } } },
      known,
    );
    expect(state?.view).toEqual({ pins: { name: "left" }, widths: { city: 200 } });
  });

  test("an invalid pin direction or width makes the whole state read as nothing remembered", () => {
    expect(sanitizeStoredListState({ view: { pins: { name: "top" } } }, known)).toBeUndefined();
    expect(sanitizeStoredListState({ view: { widths: { name: -5 } } }, known)).toBeUndefined();
    expect(sanitizeStoredListState({ view: { widths: { name: 0 } } }, known)).toBeUndefined();
  });
});
