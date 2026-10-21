import { useRef, useSyncExternalStore } from "react";
import type { Store } from "../headless/index.ts";

// React bindings for Kumiko's store primitive (`createStore` from
// @cosmicdrift/kumiko-renderer/headless). Both hooks are thin wrappers around React's
// useSyncExternalStore — the whole subscribe/notify mechanism lives in the
// store itself, only React wiring happens here.
//
// useStore: returns the whole snapshot. Re-renders when the store changes
// its identity. The Object.is gate in the store itself prevents no-op
// updates.
//
// useStoreSelector: gibt eine abgeleitete Sicht zurück. Selectors die
// Object-/Array-Literale zurückgeben (z.B. `s => ({ a, b })`) erzeugen
// pro Render eine neue Identität — useSyncExternalStore würde das als
// "Change" lesen und in eine Re-Render-Schleife laufen. Der dritte
// Arg `equals` dient genau dafür: gleiche Auswahl → cached
// Identität zurück, kein Re-Render.

// @wrapper-known semantic-alias
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useStoreSelector<T, S>(
  store: Store<T>,
  select: (snapshot: T) => S,
  equals: (a: S, b: S) => boolean = Object.is,
): S {
  // Cache der letzten Auswahl. Beim nächsten getSnapshot-Call vergleicht
  // der Wrapper die neu berechnete Auswahl mit dem Cache und gibt — falls
  // gleich — die cached Identität zurück. Das ist der Trick, der
  // Selector-Returns wie `s => ({ a, b })` stabil hält.
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
