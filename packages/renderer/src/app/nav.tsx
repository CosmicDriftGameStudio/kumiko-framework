import { createContext, type ReactNode, useContext } from "react";

// Navigation-Contract, plattform-neutral. Types + Context + Hook leben
// hier; die konkrete Implementation (window.history im Web,
// react-navigation im Native) kommt via `<NavProvider value={...}>`
// vom Plattform-Package rein.
//
// Pfad-Format bleibt einheitlich: `/<screenId>[/<entityId>]`. Parser
// und Formatter sind reine Funktionen und leben hier, damit Tests +
// andere Plattformen sie ohne DOM-Setup verwenden können.

export type NavRoute = {
  readonly screenId: string;
  readonly entityId?: string;
};

export type NavTarget = {
  readonly screenId: string;
  readonly entityId?: string;
};

export type NavApi = {
  /** Current route — `undefined` when the URL is at the root / there's
   *  no route selected. Caller's initial fallback kicks in then. */
  readonly route: NavRoute | undefined;
  /** Push a new route. Platform-specific Impl writes to
   *  history/stack and notifies subscribers. */
  readonly navigate: (target: NavTarget) => void;
  /** Build the href a click on {target} would produce. Used by
   *  platform-specific Link-Komponenten (Web: `<a href>`; Native
   *  typically doesn't need this). */
  readonly hrefFor: (target: NavTarget) => string;
};

// Pfad-Format: `/task-list`, `/task-edit/abc-123`, `/` für "keine Route".
// Alles nach den ersten zwei Segmenten wird ignoriert — kumikos
// Navigation-Grammatik nested nicht weiter. Nested-Routes ist eine
// Spec-Änderung, nicht ein URL-Shape-Unfall.
export function parsePath(pathname: string): NavRoute | undefined {
  const parts = pathname.split("/").filter((p) => p !== "");
  const [screenId, entityId] = parts;
  if (screenId === undefined || screenId === "") return undefined;
  return { screenId, ...(entityId !== undefined && { entityId }) };
}

export function formatPath(target: NavTarget): string {
  return target.entityId !== undefined
    ? `/${target.screenId}/${target.entityId}`
    : `/${target.screenId}`;
}

// Context + Hook. Default ist `undefined` damit fehlender Provider
// laut kracht statt ein silent-no-op NavApi mit toten navigate()
// Aufrufen anzubieten.
const NavContext = createContext<NavApi | undefined>(undefined);

export type NavProviderProps = {
  readonly children: ReactNode;
  readonly value: NavApi;
};

export function NavProvider({ children, value }: NavProviderProps): ReactNode {
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNav(): NavApi {
  const api = useContext(NavContext);
  if (api === undefined) {
    throw new Error(
      "useNav: no <NavProvider> mounted above this component. Plattform-Packages (z.B. @kumiko/renderer-web) liefern eine Default-Impl über createKumikoApp.",
    );
  }
  return api;
}
