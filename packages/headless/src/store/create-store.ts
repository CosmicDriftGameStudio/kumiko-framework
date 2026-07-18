import type { WritableStore } from "./types";

// Subscribe/Emit primitive matching React's useSyncExternalStore.
// Single canonical implementation — every stateful controller in
// ui-core/renderer land composes on top of this instead of rolling
// its own listener-set + notify-loop.
//
// Reentrancy semantics use the Set's documented iteration behavior:
// listeners deleted DURING the notify-loop but BEFORE their turn are
// skipped; listeners deleting themselves AFTER firing don't break the
// loop (Set iteration tolerates concurrent mutation of already-visited
// entries). MDN: "callbackFn is not invoked for values deleted before
// being visited." This is exactly the contract callers expect.
//
// Caveat — Function-valued stores: setState detects the reducer-form via
// `typeof next === "function"`. If T itself is a function type
// (`createStore<() => string>(...)`), there is no way to tell a "new
// value that happens to be a function" apart from a "reducer producing a
// new function". Same trap React's useState has. Workaround: wrap the
// new function in a reducer that ignores prev:
//   store.setState(() => myNewFn);
// In practice, function-valued stores are rare — feature controllers
// hold values, not callbacks.

export function createStore<T>(initial: T): WritableStore<T> {
  let snapshot = initial;
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setState: (next) => {
      const nextValue = typeof next === "function" ? (next as (prev: T) => T)(snapshot) : next;
      // skip: next value identical to snapshot, avoid notifying listeners
      if (Object.is(nextValue, snapshot)) return;
      snapshot = nextValue;
      for (const listener of listeners) listener();
    },
  };
}
