import { createContext, type ReactNode, useContext } from "react";
import type { FeatureSchema } from "./feature-schema";
import { qualifyScreenId } from "./qualify-screen-id";

// Navigation-Contract, plattform-neutral. Types + Context + Hook leben
// hier; die konkrete Implementation (window.history im Web,
// react-navigation im Native) kommt via `<NavProvider value={...}>`
// vom Plattform-Package rein.
//
// Pfad-Format hat zwei Modi je nach App-Schema:
//   * ohne Workspaces: `/<screenId>[/<entityId>]`
//   * mit Workspaces:  `/<workspaceId>/<screenId>[/<entityId>]`
// Der Mode wird beim parsePath() per `hasWorkspaces` Flag durchgereicht
// — Schema-Layer entscheidet, parsePath bleibt dumm/pure. formatPath()
// braucht keinen Hint: target.workspaceId vorhanden → Prefix; sonst flach.

export type NavRoute = {
  // Active workspace short id, present iff the app runs in workspace
  // mode (schema.workspaces non-empty). undefined for non-workspace apps.
  readonly workspaceId?: string;
  readonly screenId: string;
  readonly entityId?: string;
};

export type ScreenTarget = {
  // Optional in workspace-aware navigate calls. Omit for cross-workspace
  // navigation (current workspace stays); set to switch workspaces in the
  // same call as picking a screen — e.g. WorkspaceSwitcher does this.
  readonly workspaceId?: string;
  readonly screenId: string;
  readonly entityId?: string;
};

// Object-based nav target — callers name WHAT they want to see (an entity's
// row) instead of WHICH screen shows it. resolveTarget() below turns this
// into a ScreenTarget by looking up the screen with matching `detailFor`.
// No edit-form resolution here: an entity can have several entityEdit
// screens (e.g. solon's "property" has three), so "the" edit screen isn't
// well-defined — callers that want a form still name its screenId directly.
export type ObjectTarget = {
  readonly workspaceId?: string;
  readonly entity: string;
  readonly id: string;
};

// No `kind` tag: `"screenId" in target` narrows cleanly, and a tag would
// force every existing NavTarget literal (every navigate/hrefFor call in
// every app) to add one for an additive ticket. See resolveTarget().
export type NavTarget = ScreenTarget | ObjectTarget;

export type NavApi = {
  /** Current route — `undefined` when the URL is at the root / there's
   *  no route selected. Caller's initial fallback kicks in then. */
  readonly route: NavRoute | undefined;
  /** Push a new route. Platform-specific Impl writes to
   *  history/stack and notifies subscribers. */
  readonly navigate: (target: NavTarget) => void;
  /** Replace the current route in place. Same effect as navigate from
   *  the user's perspective, but doesn't add a history entry — used for
   *  mount-time URL fills (e.g. WorkspaceShell defaulting to `/admin/x`
   *  when the user typed `/`). Browser Back must take the user out of
   *  the app, not back to the original empty path. */
  readonly replace: (target: NavTarget) => void;
  /** Build the href a click on {target} would produce. Used by
   *  platform-specific Link-Komponenten (Web: `<a href>`; Native
   *  typically doesn't need this). */
  readonly hrefFor: (target: NavTarget) => string;
  /** Lese-Snapshot der aktuellen Search-Params (Browser: ?key=value-
   *  Pairs nach dem Pfad). Native-Impls die kein URL-Konzept haben
   *  liefern ein leeres Object. Wert ist ein Plain-Record (kein Map)
   *  damit React-Subscribers shallow-compare können. */
  readonly searchParams: Readonly<Record<string, string>>;
  /** Mergt Updates in die aktuellen Search-Params. Wert `null` löscht
   *  den Key. Ändert NICHT den Pfad. Plattform-Impls nutzen
   *  history.replaceState (kein Push) — Sort/Filter-Toggles sollen
   *  nicht die Back-Navigation fluten. Native-Impls können no-op'en
   *  wenn das Konzept nicht existiert. */
  readonly setSearchParams: (updates: Readonly<Record<string, string | null>>) => void;
};

// Pfad-Format:
//   ohne workspaces: `/task-list`, `/task-edit/abc-123`, `/` → undefined
//   mit workspaces:  `/admin/task-list`, `/admin/task-edit/abc`,
//                    `/admin` → workspace-only (no screen yet),
//                    `/` → undefined.
// Alles nach den ersten 2/3 Segmenten wird ignoriert — kumikos
// Navigation-Grammatik nested nicht weiter. Nested-Routes wäre eine
// Spec-Änderung, nicht ein URL-Shape-Unfall.
export function parsePath(pathname: string, hasWorkspaces?: boolean): NavRoute | undefined {
  const parts = pathname.split("/").filter((p) => p !== "");
  if (hasWorkspaces === true) {
    const [workspaceId, screenId, entityId] = parts;
    if (workspaceId === undefined || workspaceId === "") return undefined;
    if (screenId === undefined || screenId === "") {
      // Workspace-only URL ("/admin") — caller resolves the default screen
      // for that workspace. We carry workspaceId WITHOUT a screen so the
      // shell can branch instead of making something up.
      return { workspaceId, screenId: "" };
    }
    return {
      workspaceId,
      screenId,
      ...(entityId !== undefined && { entityId }),
    };
  }
  const [screenId, entityId] = parts;
  if (screenId === undefined || screenId === "") return undefined;
  return { screenId, ...(entityId !== undefined && { entityId }) };
}

export function formatPath(target: ScreenTarget): string {
  // Workspace-Mode: prefix the workspace short id. Order matters —
  // workspace before screen mirrors parsePath's segment order.
  const segments: string[] = [];
  if (target.workspaceId !== undefined) segments.push(target.workspaceId);
  segments.push(target.screenId);
  if (target.entityId !== undefined) segments.push(target.entityId);
  return `/${segments.join("/")}`;
}

// Resolves a NavTarget to the ScreenTarget form navigate/replace/hrefFor
// operate on. Pure — no context, no I/O — so callers can use it outside
// React too (see resolve-at-NavApi-build alternative in renderer-web).
export function resolveTarget(features: readonly FeatureSchema[], target: NavTarget): ScreenTarget {
  if ("screenId" in target) return target;

  for (const feature of features) {
    for (const screen of feature.screens) {
      if (screen.detailFor !== target.entity) continue;
      return {
        ...(target.workspaceId !== undefined && { workspaceId: target.workspaceId }),
        screenId: qualifyScreenId(feature.featureName, screen.id),
        entityId: target.id,
      };
    }
  }

  throw new Error(
    `resolveTarget: no detail screen for entity "${target.entity}". Add detailFor: "${target.entity}" to the screen that shows it.`,
  );
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
      "useNav: no <NavProvider> mounted above this component. Plattform-Packages (z.B. @cosmicdrift/kumiko-renderer-web) liefern eine Default-Impl über createKumikoApp.",
    );
  }
  return api;
}
