// Browser-impl of workspace-id state: ?w=<id> in the URL search-params.
// Same architectural choice as nav.tsx: window.location is the source of
// truth, useSyncExternalStore reflects it into React. A hand-rolled
// listener-set (notify-on-push + popstate-window-listener) is the
// idiomatic pair — createStore would either need a tick-counter
// (anti-pattern) or duplicate the URL state.
//
// Scope: this hook owns ONLY the ?w= param. nav.tsx owns the pathname.
// Both subscribe to popstate independently; their pushes don't interfere
// because each only writes its own slice of the URL. (Followup: have
// nav.tsx's pushPath() preserve the existing search so a nav click
// doesn't drop the active workspace.)

import { useCallback, useSyncExternalStore } from "react";

const PARAM_NAME = "w";

const listeners = new Set<() => void>();
let popstateWired = false;

function ensurePopstateWired(): void {
  if (popstateWired) return;
  if (typeof window === "undefined") return;
  window.addEventListener("popstate", () => {
    for (const l of listeners) l();
  });
  popstateWired = true;
}

function subscribe(listener: () => void): () => void {
  ensurePopstateWired();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readWorkspaceId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return new URLSearchParams(window.location.search).get(PARAM_NAME) ?? undefined;
}

function pushWorkspaceId(id: string | undefined): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (id === undefined) params.delete(PARAM_NAME);
  else params.set(PARAM_NAME, id);
  const search = params.toString();
  const next = window.location.pathname + (search.length > 0 ? `?${search}` : "");
  // No-op when the URL is already at the target; keeps pushState from
  // flooding history with identical entries on rapid re-selects.
  if (window.location.pathname + window.location.search === next) return;
  window.history.pushState(null, "", next);
  for (const l of listeners) l();
}

/** React hook: reads the active workspace id from `?w=` and returns a
 *  setter that writes back through pushState. Use in WorkspaceShell to
 *  make the active workspace shareable / bookmark-able / reload-stable.
 *  Returns `[id | undefined, setId]`. */
export function useBrowserWorkspaceQuery(): readonly [
  string | undefined,
  (id: string | undefined) => void,
] {
  const id = useSyncExternalStore(subscribe, readWorkspaceId, () => undefined);
  const setId = useCallback((next: string | undefined) => pushWorkspaceId(next), []);
  return [id, setId];
}
