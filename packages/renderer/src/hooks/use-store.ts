import { useRef, useSyncExternalStore } from "react";
import type { Store } from "../headless/index.ts";

// React bindings for Kumiko's store primitive (`createStore` from
// @cosmicdrift/kumiko-renderer/headless). Both hooks are thin wrappers around React's
// useSyncExternalStore — the entire subscribe/notify mechanism lives in the
// store itself; only React wiring happens here.
//
// useStore: returns the whole snapshot and re-renders when the store changes
// its identity. The Object.is gate in the store prevents no-op updates.
//
// useStoreSelector: returns a derived view. Selectors that return object or
// array literals (e.g. `s => ({ a, b })`) create a new identity on every
// render — useSyncExternalStore would interpret this as a change and enter
// a re-render loop. The `equals` argument handles this case: when the
// selection is equal, the cached identity is returned and no re-render occurs.

// @wrapper-known semantic-alias
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useStoreSelector<T, S>(
  store: Store<T>,
  select: (snapshot: T) => S,
  equals: (a: S, b: S) => boolean = Object.is,
): S {
  // Cache of the last selection. On the next getSnapshot call, the wrapper
  // compares the newly computed selection with the cache and returns the
  // cached identity when they are equal. This keeps selector results such as
  // `s => ({ a, b })` stable.
  const lastSelected = useRef<{ readonly value: S } | null>(null);

  const getSelectedSnapshot = (): S => {
    const next = select(store.getSnapshot());
    const cached = lastSelected.current;
    if (cached !== null && equals(cached.value, next)) return cached.value;
    lastSelected.current = { value: next };
    return next;
  };

  return useSyncExternalStore(store.subscribe, getSelectedSnapshot, getSelectedSnapshot);
}
