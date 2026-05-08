// TargetResolverStub — V.1.1-Phase-Placeholder für TargetRef-Dispatch.
//
// **Was er ersetzt.** Die echte TargetResolver-Component (Resolver-
// Registry pro featureId, Editor-Panel-Mount, URL-State-Bridge) kommt
// in V.1.2 wenn publicstatus als erster Konsument zeigt was der
// Editor-Panel-Mount-Form (split-pane vs modal) konkret braucht.
//
// **Was V.1.1 sicherstellt**: das Tree → Click → Dispatch-Wiring
// funktioniert end-to-end. Klick auf TreeNode mit `target` ruft
// `dispatch(target)` auf; per Default geht das in `console.debug`,
// Tests können via `setDispatchListener(fn)` einen Spy registrieren.
//
// **Warum Stub statt nichts.** Memory `[Inhalt vor Hülle]` — V.1.1's
// Wert ist Provider-Iteration + Tree-Render. Editor-Panel-Mount ist
// Plumbing für V.1.2-Consumer. Aber: die Click-Dispatch-Schleife muss
// in V.1.1 beweisbar funktionieren, sonst kann der V.1.1-Integration-
// Test (V.1.1-D Pflicht 4) nicht den TargetRef-Pfad pinnen. Stub-
// Pattern wie schon Schicht 3 (VisualTreeStub) — bewährt.
//
// Siehe visual-tree.md V.1.1-B.

import type { TargetRef } from "@cosmicdrift/kumiko-framework/engine";

type DispatchListener = (target: TargetRef) => void;

let testListener: DispatchListener | undefined;

/** Default-Dispatch — loggt zur dev-console. Wird vom Stub aufgerufen
 *  wenn kein Test-Listener registriert ist. V.1.2-TargetResolver
 *  ersetzt diese Logik durch Editor-Panel-Mount + URL-State-Bridge. */
function defaultDispatch(target: TargetRef): void {
  // biome-ignore lint/suspicious/noConsole: dev-stub bis V.1.2 echte Resolver liefert
  console.debug("[VisualTree] target dispatched (stub)", target);
}

/** Dispatcht einen TargetRef. Tree-Component ruft das bei TreeNode-
 *  Click auf. Wenn ein Test-Listener registriert ist (via
 *  setDispatchListener), kriegt der den Call statt der Default-Console-
 *  Output — gleiches Hook-Pattern wie testing-library's act/spy. */
export function dispatchTarget(target: TargetRef): void {
  if (testListener !== undefined) {
    testListener(target);
    return;
  }
  defaultDispatch(target);
}

/** Test-Hook: registriert einen Spy der alle dispatchTarget-Calls
 *  abfängt. Returnt eine cleanup-Function die den Listener wieder
 *  abmeldet — `afterEach`-pattern in vitest. Production-Code nutzt
 *  diese Function nicht.
 *
 *  Wichtig: nicht parallel zu Production-Code aufrufen — die Stub-
 *  Implementation hat keinen Multi-Listener-Stack, ein Test gewinnt. */
export function setDispatchListener(fn: DispatchListener): () => void {
  testListener = fn;
  return () => {
    testListener = undefined;
  };
}
