import { useEffect, useRef } from "react";

/**
 * Runs `run` once per key change without a raw useEffect in app code (the
 * no-raw-hooks guard forbids those). `key === null` means "not ready yet":
 * nothing runs and the last seen key is kept, so A -> null -> A does not fire
 * again. The first non-null key runs unless `initial` is "skip", which only
 * remembers it. A new `run` identity for the same key never re-runs. Keys are
 * primitives compared with Object.is: build composite keys as a string, an
 * inline object would fire on every render.
 */
export function useOnKeyChange<K extends string | number | boolean>(
  key: K | null,
  run: (key: K) => void,
  options?: { readonly initial?: "run" | "skip" },
): void {
  const initial = options?.initial ?? "run";
  const lastKey = useRef<K | null>(null);
  useEffect(() => {
    if (key === null) return;
    const previous = lastKey.current;
    if (previous !== null && Object.is(previous, key)) return;
    lastKey.current = key;
    if (previous === null && initial === "skip") return;
    run(key);
  }, [key, run, initial]);
}
