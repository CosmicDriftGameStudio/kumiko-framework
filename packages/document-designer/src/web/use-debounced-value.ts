import { useEffect, useState } from "react";

// Unlike useDeferredValue this waits for a quiet period, so a burst of
// keystrokes triggers one server round-trip instead of one per keystroke.
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
