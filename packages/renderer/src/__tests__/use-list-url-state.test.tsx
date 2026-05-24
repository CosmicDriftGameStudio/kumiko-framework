//
// useListUrlState pinnt den URL-State-Vertrag pro Screen-ID-Namespace:
// `?<screenId>.sort=…&<screenId>.dir=…&<screenId>.q=…&<screenId>.page=…`.
// Zwei Listen auf der Route teilen sich die URL ohne Param-Konflikt.
// Page wird bei Sort/Filter-Wechsel reseted; Sort bleibt bei Search.
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, test } from "bun:test";
import type { NavApi } from "../app/nav";
import { NavProvider } from "../app/nav";
import { useListUrlState } from "../hooks/use-list-url-state";
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
  test("Default-State: kein URL-Param → sort=null, q='', page=1", () => {
    const nav = makeNav();
    const { result } = renderHook(() => useListUrlState("orders"), { wrapper: wrapper(nav) });
    expect(result.current.sort).toBeNull();
    expect(result.current.q).toBe("");
    expect(result.current.page).toBe(1);
  });
  test("liest sort+dir aus URL-Params (mit screenId-Prefix)", () => {
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
  test("setSort schreibt sort+dir, resettet page (atomic update)", () => {
    const nav = makeNav({ "orders.page": "5" });
    const { result } = renderHook(() => useListUrlState("orders"), { wrapper: wrapper(nav) });
    act(() => {
      result.current.setSort({ field: "name", dir: "asc" });
    });
    expect(nav.captures).toHaveLength(1);
    expect(nav.captures[0]).toEqual({
      "orders.sort": "name",
      "orders.dir": "asc",
      "orders.page": null, // page-reset bei sort-change
    });
  });
  test("setSort(null) löscht sort+dir+page", () => {
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
  test("setQ schreibt q + resettet page (Sort bleibt unangetastet)", () => {
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
    // Sort darf NICHT in den captures sein — search-change zerlegt
    // die Sortierung nicht.
    expect(nav.captures[0]).not.toHaveProperty("orders.sort");
  });
  test("setQ('') löscht den q-Key", () => {
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
  test("setPage(1) löscht den Key (Default-Page = unprefixed URL)", () => {
    const nav = makeNav({ "orders.page": "5" });
    const { result } = renderHook(() => useListUrlState("orders"), { wrapper: wrapper(nav) });
    act(() => {
      result.current.setPage(1);
    });
    expect(nav.captures[0]).toEqual({ "orders.page": null });
  });
  test("setPage(N>1) speichert die Page als String", () => {
    const nav = makeNav();
    const { result } = renderHook(() => useListUrlState("orders"), { wrapper: wrapper(nav) });
    act(() => {
      result.current.setPage(7);
    });
    expect(nav.captures[0]).toEqual({ "orders.page": "7" });
  });
  test("invalid page (negativ, NaN, 0) → fallback auf 1", () => {
    const nav = makeNav({ "orders.page": "-3" });
    const { result } = renderHook(() => useListUrlState("orders"), { wrapper: wrapper(nav) });
    expect(result.current.page).toBe(1);
  });
});
