// Read/write coverage for `useBrowserNavApi` searchParams. Before this suite,
// the `window.location.search ↔ NavApi.searchParams` mapping was tested only
// indirectly through `useListUrlState` with a mock NavApi; the real
// URLSearchParams parse and replaceState round trip was untested.

import { describe, expect, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { listFilterUrlKey, NavProvider, useListUrlState } from "../../index.ts";
import { useBrowserNavApi } from "../app/nav.tsx";

function setLocation(pathname: string, search: string): void {
  window.history.replaceState(null, "", `${pathname}${search}`);
}

describe("useBrowserNavApi — searchParams", () => {
  test("reads current ?key=value pairs as a plain record", () => {
    setLocation("/orders", "?orders.sort=createdAt&orders.dir=desc");
    const { result } = renderHook(() => useBrowserNavApi());
    expect(result.current.searchParams).toEqual({
      "orders.sort": "createdAt",
      "orders.dir": "desc",
    });
  });

  test("empty ? suffix → empty record (no crash)", () => {
    setLocation("/orders", "");
    const { result } = renderHook(() => useBrowserNavApi());
    expect(result.current.searchParams).toEqual({});
  });

  test("setSearchParams: writes URL via replaceState (no history push)", () => {
    setLocation("/orders", "");
    const initialHistoryLength = window.history.length;
    const { result } = renderHook(() => useBrowserNavApi());
    act(() => {
      result.current.setSearchParams({ "orders.sort": "name", "orders.dir": "asc" });
    });
    expect(window.location.search).toBe("?orders.sort=name&orders.dir=asc");
    // replaceState rather than pushState keeps the history length unchanged.
    expect(window.history.length).toBe(initialHistoryLength);
  });

  test("setSearchParams: null removes the key", () => {
    setLocation("/orders", "?orders.sort=name&orders.dir=asc");
    const { result } = renderHook(() => useBrowserNavApi());
    act(() => {
      result.current.setSearchParams({ "orders.dir": null });
    });
    expect(window.location.search).toBe("?orders.sort=name");
  });

  test("setSearchParams: multiple updates atomically (sort+dir+page in a single call)", () => {
    setLocation("/orders", "?orders.page=5");
    const { result } = renderHook(() => useBrowserNavApi());
    act(() => {
      result.current.setSearchParams({
        "orders.sort": "createdAt",
        "orders.dir": "desc",
        "orders.page": null,
      });
    });
    // The output order is stable because URLSearchParams preserves insertion order;
    // deleting an entry shortens the list.
    expect(window.location.search).toContain("orders.sort=createdAt");
    expect(window.location.search).toContain("orders.dir=desc");
    expect(window.location.search).not.toContain("orders.page");
  });

  test("re-render after setSearchParams: searchParams reflects new state", () => {
    setLocation("/orders", "");
    const { result, rerender } = renderHook(() => useBrowserNavApi());
    act(() => {
      result.current.setSearchParams({ "orders.q": "acme" });
    });
    rerender();
    expect(result.current.searchParams).toEqual({ "orders.q": "acme" });
  });

  test("path remains unchanged when calling setSearchParams", () => {
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

  test("navigating to the current path keeps the query, searchParams {} clears it", () => {
    setLocation("/orders", "?orders.f.status=open");
    const initialHistoryLength = window.history.length;
    const { result } = renderHook(() => useBrowserNavApi());
    act(() => {
      result.current.navigate({ screenId: "orders" });
    });
    expect(window.location.search).toBe("?orders.f.status=open");
    expect(window.history.length).toBe(initialHistoryLength);
    act(() => {
      result.current.navigate({ screenId: "orders" }, { searchParams: {} });
    });
    expect(window.location.search).toBe("");
    expect(window.history.length).toBe(initialHistoryLength + 1);
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

function BrowserNav({ children }: { readonly children: ReactNode }): ReactNode {
  return <NavProvider value={useBrowserNavApi()}>{children}</NavProvider>;
}

describe("navigate into a filtered list", () => {
  test("a filter passed as searchParams is the list's active filter", () => {
    setLocation("/orders", "");
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
