// Browser-Impl der Navigation: HTML5-History + popstate subscribe.
// Types + Context + useNav leben im shared `@kumiko/renderer`; dieser
// File liefert nur die Web-spezifische NavApi-Instanz und die
// `<KumikoLink>` Anchor-Komponente.
//
// Bewusst KEIN createStore: Source-of-truth ist `window.location.pathname`
// (extern, kann via replaceState außerhalb unserer Kontrolle wechseln).
// Ein Store wäre entweder eine zweite Wahrheit (Drift-Risiko) oder ein
// reiner Tick-Counter (Anti-Pattern — createStore ist State-Holder, kein
// Event-Bus). Hand-rolled Listener-Set ist hier idiomatisch: zwei
// Notify-Trigger (eigenes pushPath, popstate-Event), nicht generalisierbar.

import { formatPath, type NavApi, type NavTarget, parsePath, useNav } from "@kumiko/renderer";
import {
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useSyncExternalStore,
} from "react";

// pushState feuert keinen popstate — wir halten einen eigenen
// Listener-Set, den navigate() notifiziert. popstate (Back/Forward)
// läuft über einen window-Listener, den wir einmalig verdrahten.
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

function readPath(): string {
  return typeof window !== "undefined" ? window.location.pathname : "/";
}

// Read der aktuellen ?key=value-Pairs als Plain-Record. URLSearchParams-
// Iterator gibt String/String — wir kollabieren auf "letzter Wert
// gewinnt" wenn ein Key mehrfach im Query auftaucht (`?a=1&a=2` → "2").
// Multi-Value-Lists sind kein Use-Case in Kumiko-Filter-State; explizit
// dokumentieren statt unspezifizierten Behavior zu liefern.
function readSearch(): string {
  return typeof window !== "undefined" ? window.location.search : "";
}

function parseSearchParams(search: string): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  if (search === "") return out;
  const params = new URLSearchParams(search);
  for (const [k, v] of params.entries()) out[k] = v;
  return out;
}

// Mergt updates in den aktuellen ?-String. `null` löscht, sonst
// überschreibt. Verwendet replaceState (KEIN push) — Sort/Filter-Toggles
// flutten sonst die Back-Navigation und User clicked sich durch
// dutzende Zwischen-States um zur vorherigen Seite zu kommen.
function applySearchParamUpdates(updates: Readonly<Record<string, string | null>>): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) {
      params.delete(key);
    } else {
      params.set(key, value);
    }
  }
  const next = params.toString();
  const nextSearch = next === "" ? "" : `?${next}`;
  if (nextSearch === window.location.search) return;
  const url = `${window.location.pathname}${nextSearch}${window.location.hash}`;
  window.history.replaceState(null, "", url);
  for (const l of listeners) l();
}

function pushPath(path: string): void {
  if (typeof window === "undefined") return;
  // Nur pushen wenn sich der Pfad wirklich ändert — doppelte navigate()
  // Aufrufe mit demselben Ziel sollen nicht die History fluten.
  if (window.location.pathname === path) return;
  window.history.pushState(null, "", path);
  for (const l of listeners) l();
}

function replacePath(path: string): void {
  if (typeof window === "undefined") return;
  // No path-change short-circuit here: callers explicitly chose replace
  // to avoid creating a history entry, even when the URL is identical.
  // (pushPath skips no-op pushes; replacePath honors the call so the
  // entry-stack semantics stay predictable.)
  window.history.replaceState(null, "", path);
  for (const l of listeners) l();
}

/** React-Hook der eine NavApi aus der Browser-History baut. Sollte
 *  einmal im App-Root aufgerufen und als value an den shared
 *  `<NavProvider>` durchgereicht werden — createKumikoApp tut das.
 *
 *  hasWorkspaces aus dem Schema (schema.workspaces non-empty) entscheidet,
 *  ob das erste URL-Segment als Workspace-id parsed wird. Pure Pass-
 *  through an parsePath; formatPath checkt selbst auf target.workspaceId. */
export function useBrowserNavApi(options?: { readonly hasWorkspaces?: boolean }): NavApi {
  const path = useSyncExternalStore(subscribe, readPath, () => "/");
  // Search wird über denselben Listener-Set notifiziert (popstate +
  // unsere replaceState-Calls), also reichen wir denselben subscribe
  // durch. Beide Snapshots werden zusammen recomputed — kein Drift
  // zwischen Pfad und Query.
  const search = useSyncExternalStore(subscribe, readSearch, () => "");
  const hasWorkspaces = options?.hasWorkspaces === true;
  const searchParams = useMemo(() => parseSearchParams(search), [search]);
  return useMemo<NavApi>(
    () => ({
      route: parsePath(path, hasWorkspaces),
      navigate: (target) => pushPath(formatPath(target)),
      replace: (target) => replacePath(formatPath(target)),
      hrefFor: (target) => formatPath(target),
      searchParams,
      setSearchParams: applySearchParamUpdates,
    }),
    [path, hasWorkspaces, searchParams],
  );
}

// ---- KumikoLink (Anchor-basiert, nur Web) ----

export type KumikoLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  readonly to: NavTarget;
};

export function KumikoLink({ to, onClick, children, ...rest }: KumikoLinkProps): ReactNode {
  const nav = useNav();
  const handleClick = useCallback(
    (e: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(e);
      if (e.defaultPrevented) return;
      // Standard-Browser-Verhalten für Cmd/Ctrl/Shift/Alt + Middle-Click
      // erhalten — nur der plain-left-click landet bei navigate().
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      nav.navigate(to);
    },
    [nav, to, onClick],
  );
  return (
    <a href={nav.hrefFor(to)} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}
