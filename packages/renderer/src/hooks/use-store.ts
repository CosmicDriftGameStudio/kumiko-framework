import type { Store } from "@cosmicdrift/kumiko-headless";
import { useRef, useSyncExternalStore } from "react";

// React-Bindings für Kumikos Store-Primitive (`createStore` aus
// @cosmicdrift/kumiko-headless). Beide Hooks sind dünne Wrapper um React's
// useSyncExternalStore — die ganze Subscribe/Notify-Mechanik lebt im
// Store selbst, hier wird nur React verdrahtet.
//
// useStore: gibt den ganzen Snapshot zurück. Re-rendert wenn der
// Store seine Identität wechselt. Object.is-Gate im Store selbst
// verhindert no-op-Updates.
//
// useStoreSelector: gibt eine abgeleitete Sicht zurück. Selectors die
// Object-/Array-Literale zurückgeben (z.B. `s => ({ a, b })`) erzeugen
// pro Render eine neue Identität — useSyncExternalStore würde das als
// "Change" lesen und in eine Re-Render-Schleife laufen. Der dritte
// Arg `equals` dient genau dafür: gleiche Auswahl → cached
// Identität zurück, kein Re-Render.

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
  const lastSelected = useRef<S>(undefined as S);
  const initialized = useRef(false);

  const getSelectedSnapshot = (): S => {
    const next = select(store.getSnapshot());
    if (initialized.current && equals(lastSelected.current, next)) {
      return lastSelected.current;
    }
    lastSelected.current = next;
    initialized.current = true;
    return next;
  };

  return useSyncExternalStore(store.subscribe, getSelectedSnapshot, getSelectedSnapshot);
}
