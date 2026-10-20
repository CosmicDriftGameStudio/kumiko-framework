import { useCallback, useRef, useState } from "react";

export const SETTLE_DELAY_MS = 400;

// Handler-driven debounce: the timer starts in the change handler, so no effect is needed.
// A timer that fires after unmount only sets state on an unmounted component, which is a no-op.
export function useSettledValue<T>(initial: T): readonly [T, (next: T) => void] {
  const [settled, setSettled] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const push = useCallback((next: T) => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setSettled(next);
    }, SETTLE_DELAY_MS);
  }, []);
  return [settled, push];
}
