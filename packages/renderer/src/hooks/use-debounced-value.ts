import { useEffect, useState } from "react";

/** Returns `value` once it has stopped changing for `delayMs`. Unlike useDeferredValue it waits for a quiet period, so a burst of keystrokes in a search field triggers one server round-trip instead of one per keystroke. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
