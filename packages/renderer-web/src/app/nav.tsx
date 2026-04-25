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

function pushPath(path: string): void {
  if (typeof window === "undefined") return;
  // Nur pushen wenn sich der Pfad wirklich ändert — doppelte navigate()
  // Aufrufe mit demselben Ziel sollen nicht die History fluten.
  if (window.location.pathname === path) return;
  window.history.pushState(null, "", path);
  for (const l of listeners) l();
}

/** React-Hook der eine NavApi aus der Browser-History baut. Sollte
 *  einmal im App-Root aufgerufen und als value an den shared
 *  `<NavProvider>` durchgereicht werden — createKumikoApp tut das. */
export function useBrowserNavApi(): NavApi {
  const path = useSyncExternalStore(subscribe, readPath, () => "/");
  return useMemo<NavApi>(
    () => ({
      route: parsePath(path),
      navigate: (target) => pushPath(formatPath(target)),
      hrefFor: (target) => formatPath(target),
    }),
    [path],
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
