// TargetResolver — V.1.2: Multi-Listener-TargetDispatch mit Test-Hook.
// V.1.4b: URL-State-Bridge via useDispatchTarget-Hook. Production schreibt
// target in nav.searchParams (F5-recovery); Subscribe-Stream bleibt für
// Test-Hooks (setDispatchListener) und Apps die kein NavProvider haben.
//
// Dispatch-Priority (V.1.2):
//   1. Test-Listener (setDispatchListener) — exklusiv, kein Production-
//      Subscriber läuft während Tests (Test-Isolation).
//   2. Production-Subscriber (subscribeTargetDispatches) — alle
//      registrierten Production-Subscriber.
//   3. Kein Test-Listener + keine Subscriber → console.debug fallback
//      (damit unhandled Klicks sichtbar bleiben).
//
// **useDispatchTarget (V.1.4b)** ist der empfohlene Production-Pfad.
// TreeNodeRenderer ruft den Hook in seinem Click-Handler — er schreibt
// URL via nav.setSearchParams UND ruft den globalen dispatchTarget für
// Test-Listener-Kompatibilität.
//
// Siehe visual-tree.md V.1.2 + V.1.4b.

import type { TargetRef } from "@cosmicdrift/kumiko-framework/engine";
import { useNav } from "@cosmicdrift/kumiko-renderer";
import { useCallback } from "react";
import { serializeTarget } from "./target-url";

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

/** V.1.4b: empfohlener Production-Dispatch. Schreibt target in
 *  nav.searchParams (URL-State, F5-fähig) UND ruft dispatchTarget für
 *  Test-Listener + legacy-Subscribers. */
export function useDispatchTarget(): (target: TargetRef) => void {
  const nav = useNav();
  return useCallback(
    (target: TargetRef) => {
      nav.setSearchParams(serializeTarget(target, nav.searchParams));
      dispatchTarget(target);
    },
    [nav],
  );
}
