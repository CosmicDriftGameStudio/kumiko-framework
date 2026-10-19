import { useSyncExternalStore } from "react";

// Matches ui/use-mobile.ts's MOBILE_BREAKPOINT. Kept as a separate constant
// because that file is vendored shadcn (regenerated via scripts/sync-shadcn.ts)
// and cannot be imported from without risking a future overwrite.
export const NARROW_VIEWPORT_BREAKPOINT_PX = 768;
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

const belowBreakpointStores = new Map<number, BelowBreakpointStore>();

function belowBreakpointStore(breakpoint: number): BelowBreakpointStore {
  const cached = belowBreakpointStores.get(breakpoint);
  if (cached !== undefined) return cached;
  const created = createBelowBreakpointStore(breakpoint);
  belowBreakpointStores.set(breakpoint, created);
  return created;
}

function getServerSnapshot(): boolean {
  return false;
}

// Unlike the vendored `useIsMobile` (ui/use-mobile.ts), which only sets its
// result in a `useEffect` and therefore always reports `false` on the first
// render regardless of actual viewport, this reads the real value up front
// via `useSyncExternalStore` — no wrong-then-corrected first render.
export function useIsViewportBelow(breakpointPx: number): boolean {
  const store = belowBreakpointStore(breakpointPx);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, getServerSnapshot);
}

export function useIsNarrowViewport(): boolean {
  return useIsViewportBelow(NARROW_VIEWPORT_BREAKPOINT_PX);
}

// Tailwind's `sm` boundary: true below 640px.
export function useIsBelowSmViewport(): boolean {
  return useIsViewportBelow(SM_BREAKPOINT);
}
