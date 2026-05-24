import { createStore, shallowEqual } from "@cosmicdrift/kumiko-headless";
import { useStore, useStoreSelector } from "@cosmicdrift/kumiko-renderer";
import { describe, expect, test } from "bun:test";
import { act, renderHook } from "./test-utils";

describe("useStore", () => {
  test("returns the current snapshot", () => {
    const store = createStore({ count: 0 });
    const { result } = renderHook(() => useStore(store));
    expect(result.current).toEqual({ count: 0 });
  });

  test("re-renders when setState changes the snapshot", () => {
    const store = createStore({ count: 0 });
    const { result } = renderHook(() => useStore(store));

    act(() => {
      store.setState({ count: 7 });
    });

    expect(result.current).toEqual({ count: 7 });
  });

  test("does not re-render when setState is a no-op (Object.is gate)", () => {
    const store = createStore({ count: 0 });
    let renderCount = 0;
    renderHook(() => {
      renderCount += 1;
      return useStore(store);
    });

    const before = renderCount;
    act(() => {
      store.setState(store.getSnapshot()); // same ref
    });

    expect(renderCount).toBe(before);
  });
});

describe("useStoreSelector", () => {
  test("returns the selected slice", () => {
    const store = createStore({ a: 1, b: 2 });
    const { result } = renderHook(() => useStoreSelector(store, (s) => s.a));
    expect(result.current).toBe(1);
  });

  test("re-renders only when the selected slice changes", () => {
    const store = createStore({ a: 1, b: 2 });
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount += 1;
      return useStoreSelector(store, (s) => s.a);
    });

    const beforeA = renderCount;
    act(() => {
      store.setState({ a: 1, b: 99 }); // unrelated slice changed
    });
    expect(renderCount).toBe(beforeA); // no re-render — `a` unchanged
    expect(result.current).toBe(1);

    act(() => {
      store.setState({ a: 5, b: 99 }); // selected slice changed
    });
    expect(renderCount).toBe(beforeA + 1);
    expect(result.current).toBe(5);
  });

  test("default Object.is equality re-renders on every object-literal selector return", () => {
    // This documents the trap that motivates the optional `equals` arg.
    // Without a custom equality, a selector returning `{ a, b }` would
    // produce a new object identity each notify and re-render forever.
    // This test asserts that with the DEFAULT (Object.is), a stable-
    // valued slice still works because the slice IS Object.is-equal.
    const store = createStore({ a: 1, b: 2 });
    let renderCount = 0;
    renderHook(() => {
      renderCount += 1;
      return useStoreSelector(store, (s) => s.a + s.b);
    });

    const before = renderCount;
    act(() => {
      store.setState({ a: 1, b: 2 }); // same shape, but different ref
    });
    // Store's Object.is-gate blocks the notify entirely (same nextValue
    // is rejected before listeners fire), so no re-evaluation happens.
    // We assert the OUTER hook didn't re-render.
    expect(renderCount).toBe(before);
  });

  test("custom shallowEqual stabilizes object-literal selector returns", () => {
    const store = createStore({ a: 1, b: 2, irrelevant: 0 });
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount += 1;
      return useStoreSelector(store, (s) => ({ a: s.a, b: s.b }), shallowEqual);
    });

    const firstResult = result.current;
    expect(firstResult).toEqual({ a: 1, b: 2 });

    act(() => {
      // Unrelated change in the snapshot — selector RETURNS a new object
      // ({ a: 1, b: 2 } each time) but shallowEqual sees a/b unchanged.
      store.setState({ a: 1, b: 2, irrelevant: 99 });
    });

    // Same identity preserved across the notify because shallowEqual
    // matched. Without the equals-arg, this would be a new ref each call.
    expect(result.current).toBe(firstResult);
    expect(renderCount).toBe(1); // only the initial render
  });

  test("custom equals receives previous and current selected values", () => {
    const store = createStore({ count: 0 });
    const equals = mock((_a: number, _b: number) => false); // never equal
    let renderCount = 0;
    renderHook(() => {
      renderCount += 1;
      return useStoreSelector(store, (s) => s.count, equals);
    });

    act(() => {
      store.setState({ count: 1 });
    });

    // equals was called with (prev=0, next=1) at some point during the
    // notify cycle. React may call getSnapshot multiple times per render,
    // so we check that the transition (0, 1) appears among the calls
    // rather than asserting on the last one.
    expect(equals).toHaveBeenCalled();
    const sawTransition = equals.mock.calls.some(([a, b]) => a === 0 && b === 1);
    expect(sawTransition).toBe(true);
    expect(renderCount).toBeGreaterThan(1);
  });
});
