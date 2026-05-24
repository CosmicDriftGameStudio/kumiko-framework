//
// useBrowserNavApi Lese-/Schreib-Pfad für searchParams. Vor dieser
// Suite war das Mapping `window.location.search ↔ NavApi.searchParams`
// nur über useListUrlState mit Mock-NavApi indirekt getestet — der
// echte URLSearchParams-Parse + replaceState-Roundtrip war ungetestet.

import { act, renderHook } from "@testing-library/react";
import { describe, expect, test } from "bun:test";
import { useBrowserNavApi } from "../app/nav";

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
