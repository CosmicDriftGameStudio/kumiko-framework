import { useSyncExternalStore } from "react";

// Matches ui/use-mobile.ts's MOBILE_BREAKPOINT. Kept as a separate constant
// because that file is vendored shadcn (regenerated via scripts/sync-shadcn.ts)
// and cannot be imported from without risking a future overwrite.
const MOBILE_BREAKPOINT = 768;
const SM_BREAKPOINT = 640;

type BelowBreakpointStore = {
  readonly subscribe: (callback: () => void) => () => void;
  readonly getSnapshot: () => boolean;
};

// Module-level stores keep subscribe stable, so useSyncExternalStore does not
// resubscribe on every render (FormFooter re-renders on each keystroke).
function createBelowBreakpointStore(breakpoint: number): BelowBreakpointStore {
  const query = `(max-width: ${breakpoint - 1}px)`;
  return {
    subscribe: (callback) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", callback);
      return () => mql.removeEventListener("change", callback);
    },
    getSnapshot: () => window.matchMedia(query).matches,
  };
}

const belowMobileStore = createBelowBreakpointStore(MOBILE_BREAKPOINT);
const belowSmStore = createBelowBreakpointStore(SM_BREAKPOINT);

function getServerSnapshot(): boolean {
  return false;
}

// Unlike the vendored `useIsMobile` (ui/use-mobile.ts), which only sets its
// result in a `useEffect` and therefore always reports `false` on the first
// render regardless of actual viewport, this reads the real value up front
// via `useSyncExternalStore` — no wrong-then-corrected first render.
export function useIsNarrowViewport(): boolean {
  return useSyncExternalStore(
    belowMobileStore.subscribe,
    belowMobileStore.getSnapshot,
    getServerSnapshot,
  );
}

// Tailwind's `sm` boundary: true below 640px.
export function useIsBelowSmViewport(): boolean {
  return useSyncExternalStore(belowSmStore.subscribe, belowSmStore.getSnapshot, getServerSnapshot);
}
