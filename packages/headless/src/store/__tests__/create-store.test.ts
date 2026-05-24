import { describe, expect, test } from "bun:test";
import { createStore } from "../create-store";

describe("createStore — snapshot & setState", () => {
  test("getSnapshot returns the initial value", () => {
    const store = createStore({ count: 0 });
    expect(store.getSnapshot()).toEqual({ count: 0 });
  });

  test("setState with a value updates the snapshot", () => {
    const store = createStore({ count: 0 });
    store.setState({ count: 5 });
    expect(store.getSnapshot()).toEqual({ count: 5 });
  });

  test("setState with a reducer receives the current snapshot", () => {
    const store = createStore({ count: 3 });
    store.setState((prev) => ({ count: prev.count + 1 }));
    expect(store.getSnapshot()).toEqual({ count: 4 });
  });

  test("getSnapshot returns stable reference when value unchanged (Object.is gate)", () => {
    const initial = { count: 0 };
    const store = createStore(initial);
    const before = store.getSnapshot();
    store.setState(initial); // same reference
    expect(store.getSnapshot()).toBe(before);
  });
});

describe("createStore — subscribe & notify", () => {
  test("subscribed listener fires on setState", () => {
    const store = createStore({ count: 0 });
    const listener = mock();
    store.subscribe(listener);

    store.setState({ count: 1 });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("multiple listeners all fire on setState", () => {
    const store = createStore({ count: 0 });
    const a = mock();
    const b = mock();
    store.subscribe(a);
    store.subscribe(b);

    store.setState({ count: 1 });

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  test("unsubscribe stops further notifications", () => {
    const store = createStore({ count: 0 });
    const listener = mock();
    const unsub = store.subscribe(listener);

    store.setState({ count: 1 });
    unsub();
    store.setState({ count: 2 });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("Object.is-equal setState does NOT notify listeners", () => {
    const store = createStore({ count: 0 });
    const same = store.getSnapshot();
    const listener = mock();
    store.subscribe(listener);

    // Same reference — gate blocks notification.
    store.setState(same);
    // Primitive-equal setState on primitive-valued store also no-ops.
    const primStore = createStore(42);
    const primListener = mock();
    primStore.subscribe(primListener);
    primStore.setState(42);

    expect(listener).not.toHaveBeenCalled();
    expect(primListener).not.toHaveBeenCalled();
  });

  test("setState inside reducer that returns same ref does NOT notify", () => {
    const store = createStore({ count: 0 });
    const listener = mock();
    store.subscribe(listener);

    store.setState((prev) => prev); // reducer returns same ref

    expect(listener).not.toHaveBeenCalled();
  });
});

describe("createStore — reentrancy safety", () => {
  test("listener unsubscribing itself during callback does not break iteration", () => {
    const store = createStore({ count: 0 });
    const order: string[] = [];

    const unsubA = store.subscribe(() => {
      order.push("a");
      unsubA(); // self-unsubscribe mid-loop
    });
    store.subscribe(() => {
      order.push("b");
    });

    store.setState({ count: 1 });

    // Both fire on this cycle; A must not prevent B from running.
    expect(order).toEqual(["a", "b"]);

    // A is gone; only B fires on the next cycle.
    order.length = 0;
    store.setState({ count: 2 });
    expect(order).toEqual(["b"]);
  });

  test("listener unsubscribing ANOTHER listener mid-loop does not re-invoke it", () => {
    const store = createStore({ count: 0 });
    const order: string[] = [];

    let unsubB: (() => void) | null = null;

    store.subscribe(() => {
      order.push("a");
      unsubB?.(); // kill B before its turn
    });
    unsubB = store.subscribe(() => {
      order.push("b");
    });

    store.setState({ count: 1 });

    // B was unsubscribed by A before iteration reached it.
    expect(order).toEqual(["a"]);
  });
});
