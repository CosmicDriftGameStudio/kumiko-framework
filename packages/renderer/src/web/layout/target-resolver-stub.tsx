// TargetResolver: multi-listener target dispatch with a test hook, plus a
// URL-state bridge via the useDispatchTarget hook. Production writes
// the target to nav.searchParams (F5 recovery); the subscription stream remains
// available for test hooks (setDispatchListener) and apps without a NavProvider.
//
// Dispatch priority:
//   1. Test listener (setDispatchListener) — exclusive; no production
//      subscriber runs during tests (test isolation).
//   2. Production subscribers (subscribeTargetDispatches) — all registered
//      production subscribers.
//   3. No test listener and no subscribers → console.debug fallback so unhandled
//      clicks remain visible.
//
// **useDispatchTarget** is the recommended production path.
// NavTree calls the hook from a target node's click handler. It writes the URL
// via nav.setSearchParams AND calls the global dispatchTarget for compatibility
// with test listeners.

import type { TargetRef } from "@cosmicdrift/kumiko-framework/engine";
import { useCallback } from "react";
import { rendererDebug } from "../../dev-console.ts";
import { requestLeave, useNav } from "../../index.ts";
import { serializeTarget } from "./target-url.ts";

type DispatchListener = (target: TargetRef) => void;

let testListener: DispatchListener | undefined;
const subscribers = new Set<DispatchListener>();

export function dispatchTarget(target: TargetRef): void {
  if (testListener !== undefined) {
    testListener(target);
    return;
  }
  if (subscribers.size > 0) {
    for (const fn of subscribers) {
      fn(target);
    }
    return;
  }
  rendererDebug("[NavTree] target dispatched (unhandled)", target);
}

/** Test-Hook: Exklusiver Spy. Returnt cleanup. */
export function setDispatchListener(fn: DispatchListener): () => void {
  testListener = fn;
  return () => {
    testListener = undefined;
  };
}

/** Registers a production subscriber and returns an unsubscribe function.
 *  It runs only when no test listener is active (test isolation). */
export function subscribeTargetDispatches(fn: DispatchListener): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

/** Recommended production dispatch. Writes the target to
 *  nav.searchParams (URL state, F5-compatible) AND calls dispatchTarget for
 *  test listeners and legacy subscribers. */
export function useDispatchTarget(): (target: TargetRef) => void {
  const nav = useNav();
  return useCallback(
    (target: TargetRef) => {
      requestLeave(() => {
        nav.setSearchParams(serializeTarget(target, nav.searchParams));
        dispatchTarget(target);
      });
    },
    [nav],
  );
}
