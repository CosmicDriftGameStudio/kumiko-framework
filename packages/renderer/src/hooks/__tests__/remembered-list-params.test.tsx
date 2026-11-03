import { describe, expect, test } from "bun:test";
import { renderHook } from "@testing-library/react";
import { type ReactNode, useCallback, useState } from "react";
import { type NavApi, NavProvider } from "../../app/nav.tsx";
import { createMemoryListStateStore } from "../../components/list-state-store.tsx";
import { useRememberedListParams } from "../use-remembered-list-params.ts";

const known = { columnFields: ["name"], filterFields: ["status"] };

function renderRemembered(
  initial: Record<string, string>,
  enabled: boolean,
  store = createMemoryListStateStore(),
) {
  let latest: Record<string, string> = initial;
  const restoringByRender: boolean[] = [];
  // biome-ignore lint/correctness/noComponentHookFactories: closes over the renderRemembered-local initial params and latest tracker; defined once per renderRemembered call, never during a render
  function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
    const [params, setParams] = useState(initial);
    latest = params;
    const setSearchParams = useCallback((updates: Readonly<Record<string, string | null>>) => {
      setParams((prev) => {
        const next = { ...prev };
        for (const [key, value] of Object.entries(updates)) {
          if (value === null) delete next[key];
          else next[key] = value;
        }
        return next;
      });
    }, []);
    const nav: NavApi = {
      route: undefined,
      navigate: () => {},
      replace: () => {},
      hrefFor: () => "",
      searchParams: params,
      setSearchParams,
    };
    return <NavProvider value={nav}>{children}</NavProvider>;
  }
  renderHook(
    () => {
      const { restoring } = useRememberedListParams({ screenId: "orders", enabled, store, known });
      restoringByRender.push(restoring);
    },
    { wrapper: Wrapper },
  );
  return { store, params: () => latest, restoringByRender };
}

describe("useRememberedListParams", () => {
  test("restores the remembered params into an empty URL", () => {
    const store = createMemoryListStateStore();
    store.write("orders", { params: { q: "acme", "f.status": "open", gone: "1" } });
    const { params } = renderRemembered({}, true, store);
    expect(params()).toEqual({ "orders.q": "acme", "orders.f.status": "open" });
  });

  test("a link that already carries list params is never overridden", () => {
    const store = createMemoryListStateStore();
    store.write("orders", { params: { q: "acme" } });
    const { params } = renderRemembered({ "orders.q": "linked" }, true, store);
    expect(params()).toEqual({ "orders.q": "linked" });
    expect(store.read("orders")?.params).toEqual({ q: "linked" });
  });

  test("without rememberState nothing is read or written", () => {
    const store = createMemoryListStateStore();
    store.write("orders", { params: { q: "acme" } });
    const { params } = renderRemembered({ "orders.q": "x" }, false, store);
    expect(params()).toEqual({ "orders.q": "x" });
    expect(store.read("orders")?.params).toEqual({ q: "acme" });
  });

  test("params of another screen are not remembered under this one", () => {
    const store = createMemoryListStateStore();
    renderRemembered({ "orders-archive.q": "x", "orders.sort": "name" }, true, store);
    expect(store.read("orders")?.params).toEqual({ sort: "name" });
  });

  test("reports restoring from the first render until the remembered params are in the URL", () => {
    const store = createMemoryListStateStore();
    store.write("orders", { params: { q: "acme" } });
    const { restoringByRender } = renderRemembered({}, true, store);
    expect(restoringByRender[0]).toBe(true);
    expect(restoringByRender.at(-1)).toBe(false);
  });

  test("never reports restoring without remembered params, with a linked URL or when disabled", () => {
    const store = createMemoryListStateStore();
    store.write("orders", { params: { q: "acme" } });
    const linked = renderRemembered({ "orders.q": "linked" }, true, store);
    const disabled = renderRemembered({}, false, store);
    const nothingStored = renderRemembered({}, true);
    for (const run of [linked, disabled, nothingStored]) {
      expect(run.restoringByRender.every((restoring) => !restoring)).toBe(true);
    }
  });
});
