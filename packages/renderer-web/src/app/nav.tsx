// Browser-Impl der Navigation: HTML5-History + popstate subscribe.
// Types + Context + useNav leben im shared `@kumiko/renderer`; dieser
// File liefert nur die Web-spezifische NavApi-Instanz und die
// `<KumikoLink>` Anchor-Komponente.

import { createStore } from "@kumiko/headless";
import { formatPath, type NavApi, type NavTarget, parsePath, useNav } from "@kumiko/renderer";
import {
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useSyncExternalStore,
} from "react";

// Source-of-truth für den aktuellen Pfad ist `window.location.pathname`
// (kann von außen via replaceState geändert werden, ohne dass wir es
// merken). Der Store dient hier rein als Notification-Bus: bei jedem
// Change-Trigger (eigene navigate() oder popstate) tickt der Counter,
// useSyncExternalStore re-evaluiert getSnapshot, das den DOM-Pfad
// frisch liest. Der Store ersetzt nur das hand-rolled Listener-Set —
// kein State-Caching, weil der DOM die Wahrheit hat.
const navTick = createStore(0);

function notifyNav(): void {
  navTick.setState((t) => t + 1);
}

let popstateWired = false;
function ensurePopstateWired(): void {
  if (popstateWired) return;
  if (typeof window === "undefined") return;
  window.addEventListener("popstate", notifyNav);
  popstateWired = true;
}

function subscribe(listener: () => void): () => void {
  ensurePopstateWired();
  return navTick.subscribe(listener);
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
  notifyNav();
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
