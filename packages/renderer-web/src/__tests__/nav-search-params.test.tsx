//
// useBrowserNavApi Lese-/Schreib-Pfad für searchParams. Vor dieser
// Suite war das Mapping `window.location.search ↔ NavApi.searchParams`
// nur über useListUrlState mit Mock-NavApi indirekt getestet — der
// echte URLSearchParams-Parse + replaceState-Roundtrip war ungetestet.

import { describe, expect, test } from "bun:test";
import { listFilterUrlKey, NavProvider, useListUrlState } from "@cosmicdrift/kumiko-renderer";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { useBrowserNavApi } from "../app/nav.js";

function setLocation(pathname: string, search: string): void {
  window.history.replaceState(null, "", `${pathname}${search}`);
}

describe("useBrowserNavApi — searchParams", () => {
  test("liest aktuelle ?key=value-Pairs als Plain-Record", () => {
    setLocation("/orders", "?orders.sort=createdAt&orders.dir=desc");
    const { result } = renderHook(() => useBrowserNavApi());
    expect(result.current.searchParams).toEqual({
      "orders.sort": "createdAt",
      "orders.dir": "desc",
    });
  });

  test("leeres ?-Suffix → leeres Record (kein crash)", () => {
    setLocation("/orders", "");
    const { result } = renderHook(() => useBrowserNavApi());
    expect(result.current.searchParams).toEqual({});
  });

  test("setSearchParams: schreibt URL via replaceState (kein History-Push)", () => {
    setLocation("/orders", "");
    const initialHistoryLength = window.history.length;
    const { result } = renderHook(() => useBrowserNavApi());
    act(() => {
      result.current.setSearchParams({ "orders.sort": "name", "orders.dir": "asc" });
    });
    expect(window.location.search).toBe("?orders.sort=name&orders.dir=asc");
    // replaceState statt pushState — History-Länge unverändert.
    expect(window.history.length).toBe(initialHistoryLength);
  });

  test("setSearchParams: null löscht den Key", () => {
    setLocation("/orders", "?orders.sort=name&orders.dir=asc");
    const { result } = renderHook(() => useBrowserNavApi());
    act(() => {
      result.current.setSearchParams({ "orders.dir": null });
    });
    expect(window.location.search).toBe("?orders.sort=name");
  });

  test("setSearchParams: mehrere Updates atomar (sort+dir+page in einem Call)", () => {
    setLocation("/orders", "?orders.page=5");
    const { result } = renderHook(() => useBrowserNavApi());
    act(() => {
      result.current.setSearchParams({
        "orders.sort": "createdAt",
        "orders.dir": "desc",
        "orders.page": null,
      });
    });
    // Reihenfolge im Output stabil weil URLSearchParams insertion-order
    // bewahrt; löschen reduziert die Liste.
    expect(window.location.search).toContain("orders.sort=createdAt");
    expect(window.location.search).toContain("orders.dir=desc");
    expect(window.location.search).not.toContain("orders.page");
  });

  test("re-render nach setSearchParams: searchParams reflektiert neuen State", () => {
    setLocation("/orders", "");
    const { result, rerender } = renderHook(() => useBrowserNavApi());
    act(() => {
      result.current.setSearchParams({ "orders.q": "acme" });
    });
    rerender();
    expect(result.current.searchParams).toEqual({ "orders.q": "acme" });
  });

  test("Pfad bleibt unangetastet bei setSearchParams", () => {
    setLocation("/dashboard", "");
    const { result } = renderHook(() => useBrowserNavApi());
    act(() => {
      result.current.setSearchParams({ "items.q": "x" });
    });
    expect(window.location.pathname).toBe("/dashboard");
  });
});

describe("useBrowserNavApi — navigate with searchParams", () => {
  test("pushes path and query as one history entry", () => {
    setLocation("/orders", "?orders.page=2");
    const initialHistoryLength = window.history.length;
    const { result } = renderHook(() => useBrowserNavApi());
    act(() => {
      result.current.navigate(
        { screenId: "composer", entityId: "v1" },
        { searchParams: { channel: "instagram", tab: "photos" } },
      );
    });
    expect(window.location.pathname).toBe("/composer/v1");
    expect(window.location.search).toBe("?channel=instagram&tab=photos");
    expect(window.history.length).toBe(initialHistoryLength + 1);
    expect(result.current.searchParams).toEqual({ channel: "instagram", tab: "photos" });
  });

  test("same path with different params pushes, identical URL does not", () => {
    setLocation("/composer/v1", "?channel=instagram");
    const initialHistoryLength = window.history.length;
    const { result } = renderHook(() => useBrowserNavApi());
    act(() => {
      result.current.navigate(
        { screenId: "composer", entityId: "v1" },
        { searchParams: { channel: "instagram" } },
      );
    });
    expect(window.history.length).toBe(initialHistoryLength);
    act(() => {
      result.current.navigate(
        { screenId: "composer", entityId: "v1" },
        { searchParams: { channel: "facebook" } },
      );
    });
    expect(window.location.search).toBe("?channel=facebook");
    expect(window.history.length).toBe(initialHistoryLength + 1);
  });

  test("without searchParams the target starts with an empty query", () => {
    setLocation("/orders", "?orders.page=2");
    const { result } = renderHook(() => useBrowserNavApi());
    act(() => {
      result.current.navigate({ screenId: "customers" });
    });
    expect(window.location.pathname).toBe("/customers");
    expect(window.location.search).toBe("");
  });

  test("replace and hrefFor take the same searchParams", () => {
    setLocation("/orders", "");
    const initialHistoryLength = window.history.length;
    const { result } = renderHook(() => useBrowserNavApi());
    expect(result.current.hrefFor({ screenId: "customers" }, { searchParams: { q: "a b" } })).toBe(
      "/customers?q=a+b",
    );
    act(() => {
      result.current.replace({ screenId: "customers" }, { searchParams: { q: "acme" } });
    });
    expect(window.location.pathname).toBe("/customers");
    expect(window.location.search).toBe("?q=acme");
    expect(window.history.length).toBe(initialHistoryLength);
  });
});

describe("navigate into a filtered list", () => {
  test("a filter passed as searchParams is the list's active filter", () => {
    setLocation("/orders", "");
    function BrowserNav({ children }: { readonly children: ReactNode }): ReactNode {
      return <NavProvider value={useBrowserNavApi()}>{children}</NavProvider>;
    }
    const { result } = renderHook(
      () => ({ nav: useBrowserNavApi(), list: useListUrlState("tasks") }),
      { wrapper: BrowserNav },
    );
    act(() => {
      result.current.nav.navigate(
        { screenId: "tasks" },
        { searchParams: { [listFilterUrlKey("tasks", "status")]: "open,blocked" } },
      );
    });
    expect(window.location.search).toBe("?tasks.f.status=open%2Cblocked");
    expect(result.current.list.filters).toEqual({ status: ["open", "blocked"] });
  });
});
