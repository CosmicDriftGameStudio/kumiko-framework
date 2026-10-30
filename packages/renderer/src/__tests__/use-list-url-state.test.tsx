//
// useListUrlState defines the URL-state contract per screen-ID namespace:
// `?<screenId>.sort=…&<screenId>.dir=…&<screenId>.q=…&<screenId>.page=…`.
// Multiple lists on the route can share the URL without parameter conflicts.
// Page resets when sorting or filters change; sorting is preserved when searching.

import { describe, expect, mock, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import type { NavApi } from "../app/nav.tsx";
import { NavProvider } from "../app/nav.tsx";
import { useListUrlState } from "../hooks/use-list-url-state.ts";

function makeNav(initial: Record<string, string> = {}): NavApi & {
  readonly current: { params: Record<string, string> };
  readonly captures: Array<Record<string, string | null>>;
} {
  const params: Record<string, string> = { ...initial };
  const captures: Array<Record<string, string | null>> = [];
  const api: NavApi & {
    current: { params: Record<string, string> };
    captures: Array<Record<string, string | null>>;
  } = {
    route: undefined,
    navigate: mock(),
    replace: mock(),
    hrefFor: () => "",
    get searchParams() {
      return params;
    },
    setSearchParams: (updates) => {
      captures.push(updates);
      for (const [k, v] of Object.entries(updates)) {
        if (v === null) delete params[k];
        else params[k] = v;
      }
    },
    current: { params },
    captures,
  };
  return api;
}
function wrapper(nav: NavApi): (props: { children: ReactNode }) => ReactNode {
  return ({ children }) => <NavProvider value={nav}>{children}</NavProvider>;
}
describe("useListUrlState", () => {
  test("Default state: no URL parameter → sort=null, q='', page=1", () => {
    const nav = makeNav();
    const { result } = renderHook(() => useListUrlState("orders"), { wrapper: wrapper(nav) });
    expect(result.current.sort).toBeNull();
    expect(result.current.q).toBe("");
    expect(result.current.page).toBe(1);
  });
  test("reads sort+dir from URL parameters (with screenId prefix)", () => {
    const nav = makeNav({ "orders.sort": "createdAt", "orders.dir": "desc" });
    const { result } = renderHook(() => useListUrlState("orders"), { wrapper: wrapper(nav) });
    expect(result.current.sort).toEqual({ field: "createdAt", dir: "desc" });
  });
  test("ignoriert sort einer ANDEREN Liste (Namespacing)", () => {
    const nav = makeNav({ "incidents.sort": "severity", "incidents.dir": "asc" });
    const { result } = renderHook(() => useListUrlState("orders"), { wrapper: wrapper(nav) });
    expect(result.current.sort).toBeNull();
  });
  test("invalid dir (z.B. 'foo') → sort=null (defensive parse)", () => {
    const nav = makeNav({ "orders.sort": "name", "orders.dir": "foo" });
    const { result } = renderHook(() => useListUrlState("orders"), { wrapper: wrapper(nav) });
    expect(result.current.sort).toBeNull();
  });
  test("setSort writes sort+dir, resets page (atomic update)", () => {
    const nav = makeNav({ "orders.page": "5" });
    const { result } = renderHook(() => useListUrlState("orders"), { wrapper: wrapper(nav) });
    act(() => {
      result.current.setSort({ field: "name", dir: "asc" });
    });
    expect(nav.captures).toHaveLength(1);
    expect(nav.captures[0]).toEqual({
      "orders.sort": "name",
      "orders.dir": "asc",
      "orders.page": null, // page reset on sort change
    });
  });
  test("setSort(null) deletes sort+dir+page", () => {
    const nav = makeNav({
      "orders.sort": "name",
      "orders.dir": "asc",
      "orders.page": "3",
    });
    const { result } = renderHook(() => useListUrlState("orders"), { wrapper: wrapper(nav) });
    act(() => {
      result.current.setSort(null);
    });
    expect(nav.captures[0]).toEqual({
      "orders.sort": null,
      "orders.dir": null,
      "orders.page": null,
    });
  });
  test("setQ writes q + resets page (sort remains untouched)", () => {
    const nav = makeNav({
      "orders.sort": "name",
      "orders.dir": "asc",
      "orders.page": "3",
    });
    const { result } = renderHook(() => useListUrlState("orders"), { wrapper: wrapper(nav) });
    act(() => {
      result.current.setQ("acme");
    });
    expect(nav.captures[0]).toEqual({
      "orders.q": "acme",
      "orders.page": null,
    });
    // Sort must not appear in the captures: a search change keeps the sort order.
    expect(nav.captures[0]).not.toHaveProperty("orders.sort");
  });
  test("setQ('') deletes the q key", () => {
    const nav = makeNav({ "orders.q": "acme" });
    const { result } = renderHook(() => useListUrlState("orders"), { wrapper: wrapper(nav) });
    act(() => {
      result.current.setQ("");
    });
    expect(nav.captures[0]).toEqual({
      "orders.q": null,
      "orders.page": null,
    });
  });
  test("setPage(1) deletes the key (default page = unprefixed URL)", () => {
    const nav = makeNav({ "orders.page": "5" });
    const { result } = renderHook(() => useListUrlState("orders"), { wrapper: wrapper(nav) });
    act(() => {
      result.current.setPage(1);
    });
    expect(nav.captures[0]).toEqual({ "orders.page": null });
  });
  test("setPage(N>1) stores the page as a string", () => {
    const nav = makeNav();
    const { result } = renderHook(() => useListUrlState("orders"), { wrapper: wrapper(nav) });
    act(() => {
      result.current.setPage(7);
    });
    expect(nav.captures[0]).toEqual({ "orders.page": "7" });
  });
  test("invalid page (negative, NaN, 0) → falls back to 1", () => {
    const nav = makeNav({ "orders.page": "-3" });
    const { result } = renderHook(() => useListUrlState("orders"), { wrapper: wrapper(nav) });
    expect(result.current.page).toBe(1);
  });

  test("reads faceted filters from .f.<field>-Keys (comma-split), namespaced", () => {
    const nav = makeNav({
      "orders.f.status": "draft,published",
      "orders.f.active": "true",
      "incidents.f.status": "open", // andere Liste → ignoriert
    });
    const { result } = renderHook(() => useListUrlState("orders"), { wrapper: wrapper(nav) });
    expect(result.current.filters).toEqual({
      status: ["draft", "published"],
      active: ["true"],
    });
  });

  test("setFilter writes comma-joined values + resets page", () => {
    const nav = makeNav({ "orders.page": "4" });
    const { result } = renderHook(() => useListUrlState("orders"), { wrapper: wrapper(nav) });
    act(() => {
      result.current.setFilter("status", ["draft", "review"]);
    });
    expect(nav.captures[0]).toEqual({
      "orders.f.status": "draft,review",
      "orders.page": null,
    });
  });

  test("setFilter with an empty array deletes the facet key", () => {
    const nav = makeNav({ "orders.f.status": "draft" });
    const { result } = renderHook(() => useListUrlState("orders"), { wrapper: wrapper(nav) });
    act(() => {
      result.current.setFilter("status", []);
    });
    expect(nav.captures[0]).toEqual({
      "orders.f.status": null,
      "orders.page": null,
    });
  });

  // The date-range facet lives in the same .f. namespace so
  // clearFilters covers it — but both bounds have to land in ONE params
  // update, or the second call overwrites the first.
  test("setDateRange writes both boundaries atomically + resets page", () => {
    const nav = makeNav({ "orders.page": "4" });
    const { result } = renderHook(() => useListUrlState("orders"), { wrapper: wrapper(nav) });
    act(() => {
      result.current.setDateRange("createdAt", { from: "2020-06-10", to: "2020-06-14" });
    });
    expect(nav.captures).toHaveLength(1);
    expect(nav.captures[0]).toEqual({
      "orders.f.createdAt.from": "2020-06-10",
      "orders.f.createdAt.to": "2020-06-14",
      "orders.page": null,
    });
  });

  test("setDateRange with an empty boundary deletes only that key", () => {
    const nav = makeNav({
      "orders.f.createdAt.from": "2020-06-10",
      "orders.f.createdAt.to": "2020-06-14",
    });
    const { result } = renderHook(() => useListUrlState("orders"), { wrapper: wrapper(nav) });
    act(() => {
      result.current.setDateRange("createdAt", { from: "", to: "2020-06-14" });
    });
    expect(nav.captures[0]).toEqual({
      "orders.f.createdAt.from": null,
      "orders.f.createdAt.to": "2020-06-14",
      "orders.page": null,
    });
  });

  test("clearFilters also deletes the date range boundaries", () => {
    const nav = makeNav({
      "orders.f.createdAt.from": "2020-06-10",
      "orders.f.createdAt.to": "2020-06-14",
    });
    const { result } = renderHook(() => useListUrlState("orders"), { wrapper: wrapper(nav) });
    act(() => {
      result.current.clearFilters();
    });
    expect(nav.captures[0]).toEqual({
      "orders.page": null,
      "orders.filter": null,
      "orders.f.createdAt.from": null,
      "orders.f.createdAt.to": null,
    });
  });

  test("clearFilters deletes all active .f.<field>-keys", () => {
    const nav = makeNav({
      "orders.f.status": "draft",
      "orders.f.active": "true",
    });
    const { result } = renderHook(() => useListUrlState("orders"), { wrapper: wrapper(nav) });
    act(() => {
      result.current.clearFilters();
    });
    expect(nav.captures[0]).toEqual({
      "orders.page": null,
      "orders.filter": null,
      "orders.f.status": null,
      "orders.f.active": null,
    });
  });
});
