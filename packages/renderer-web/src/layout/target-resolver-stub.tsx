// TargetResolver — V.1.2: Multi-Listener-TargetDispatch mit Test-Hook.
// Der V.1.1-Stub (console.debug) wird durch Production-Subscriber
// ersetzt — EditorPanel, URL-State-Bridge, etc. registrieren sich
// via subscribeTargetDispatches().
//
// Dispatch-Priority:
//   1. Test-Listener (setDispatchListener) — exklusiv, kein Production-
//      Subscriber läuft während Tests (Test-Isolation).
//   2. Production-Subscriber (subscribeTargetDispatches) — alle
//      registrierten Production-Subscriber.
//   3. Kein Test-Listener + keine Subscriber → console.debug fallback
//      (damit unhandled Klicks sichtbar bleiben).
//
// Siehe visual-tree.md V.1.2.

import type { TargetRef } from "@cosmicdrift/kumiko-framework/engine";

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
  // biome-ignore lint/suspicious/noConsole: fallback wenn kein Subscriber registered
  console.debug("[VisualTree] target dispatched (unhandled)", target);
}

/** Test-Hook: Exklusiver Spy. Returnt cleanup. */
export function setDispatchListener(fn: DispatchListener): () => void {
  testListener = fn;
  return () => {
    testListener = undefined;
  };
}

/** Production-Subscriber registrieren. Returnt unsubscribe. Läuft nur
 *  wenn kein Test-Listener aktiv (Test-Isolation). */
export function subscribeTargetDispatches(fn: DispatchListener): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}
