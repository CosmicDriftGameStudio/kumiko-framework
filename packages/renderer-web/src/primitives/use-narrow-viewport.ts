import { useSyncExternalStore } from "react";

// Matches ui/use-mobile.ts's MOBILE_BREAKPOINT. Kept as a separate constant
// because that file is vendored shadcn (regenerated via scripts/sync-shadcn.ts)
// and cannot be imported from without risking a future overwrite.
const MOBILE_BREAKPOINT = 768;

function subscribe(callback: () => void): () => void {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getSnapshot(): boolean {
  return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`).matches;
}

function getServerSnapshot(): boolean {
  return false;
}

// Unlike the vendored `useIsMobile` (ui/use-mobile.ts), which only sets its
// result in a `useEffect` and therefore always reports `false` on the first
// render regardless of actual viewport, this reads the real value up front
// via `useSyncExternalStore` — no wrong-then-corrected first render.
export function useIsNarrowViewport(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
