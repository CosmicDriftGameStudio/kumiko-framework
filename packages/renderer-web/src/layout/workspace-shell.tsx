// WorkspaceShell — App-shell for multi-persona apps. Renders the
// switcher in the topbar center slot, picks the active workspace from
// URL state (?w=<id>) or default, and feeds the active workspace's
// nav-membership down to NavTree as an allow-set.
//
// Apps that don't need workspaces stick with DefaultAppShell. Both
// shells live side-by-side; createKumikoApp's `shell` prop picks one.
//
// Active-workspace resolution priority:
//   1. URL workspace segment `/<workspace>/...`  (user-driven, shareable)
//   2. `initialWorkspaceId` prop                  (caller-pinned, SSR/test)
//   3. WorkspaceDefinition with default:true      (engine-validated unique)
//   4. First workspace the user has access to
//
// State lives in the URL as the single source of truth via the standard
// nav route (`useNav().route.workspaceId`). No local React state —
// tenant-switches and role refreshes heal automatically: `visible`
// recomputes, the URL id no longer matches a visible workspace, the
// resolution chain falls through to the default. Reloads / bookmarks /
// shared links keep the active workspace because it's part of the URL.
//
// The switcher's onSelect calls nav.navigate({ workspaceId, screenId })
// where screenId is the first nav-member of the target workspace, so a
// click lands on a real screen instead of an unresolved root URL.
//
// Roles gating:
//   * access.openToAll → always shown
//   * access.roles     → shown only when user.roles ∩ access.roles ≠ ∅
//   * access undefined → shown to everyone (engine convention — same
//                        rule that NavDefinition.access follows)

import type { AccessRule } from "@kumiko/framework/ui-types";
import type { AppSchema, FeatureSchema, WorkspaceSchema } from "@kumiko/renderer";
import { toAppSchema, useNav } from "@kumiko/renderer";
import { type ReactNode, useCallback, useLayoutEffect, useMemo } from "react";
import { AppLayout } from "./app-layout";
import { lastSegment, NavTree } from "./nav-tree";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { WorkspaceSwitcher } from "./workspace-switcher";

export type WorkspaceShellUser = {
  readonly id: string;
  readonly roles: readonly string[];
};

export type WorkspaceShellProps = {
  /** Branding / logo on the left side of the topbar. */
  readonly brand: ReactNode;
  /** Schema mit `workspaces` populated — die engine baut das aus
   *  registry.getAllWorkspaces() + getWorkspaceNavs(). Akzeptiert
   *  AppSchema (multi-feature) oder die legacy FeatureSchema (single-
   *  feature, workspaces inline). Ohne Workspaces fällt der Shell auf
   *  plain NavTree ohne Switcher zurück. */
  readonly schema: AppSchema | FeatureSchema;
  /** Optional topbar end-slot — TenantSwitcher / ThemeToggle / UserMenu. */
  readonly topbarActions?: ReactNode;
  /** Current user. Drives which workspaces appear in the switcher. */
  readonly user?: WorkspaceShellUser;
  /** Initial active workspace short id ("admin"). When omitted: default
   *  workspace from schema, otherwise first accessible. Useful for SSR
   *  and tests to pre-seed without hitting the URL. */
  readonly initialWorkspaceId?: string;
  /** Footer-Slot unten in der Sidebar — Profile-Row, Help-Link, Build-
   *  Info. Klebt am unteren Rand via `mt-auto` (siehe Sidebar.footer).
   *  Symmetrisch zu DefaultAppShell.sidebarFooter. */
  readonly sidebarFooter?: ReactNode;
  /** Screen content. */
  readonly children: ReactNode;
};

export function WorkspaceShell({
  brand,
  schema,
  topbarActions,
  user,
  initialWorkspaceId,
  sidebarFooter,
  children,
}: WorkspaceShellProps): ReactNode {
  const app = useMemo(() => toAppSchema(schema), [schema]);
  const visible = useMemo<readonly WorkspaceSchema[]>(
    () => filterByAccess(app.workspaces ?? [], user?.roles),
    [app.workspaces, user?.roles],
  );

  const nav = useNav();
  const routeWorkspaceId = nav.route?.workspaceId;

  // Single source of truth: URL > initial > engine-default > first visible.
  // Recomputed on every dependency change — no local state, no stale-id
  // healing useEffect. If the URL points at a workspace the user can no
  // longer access (e.g. after a tenant-switch), the chain falls through
  // to the resolveDefaultId fallback.
  const activeId = useMemo(() => {
    if (
      routeWorkspaceId !== undefined &&
      visible.some((ws) => ws.definition.id === routeWorkspaceId)
    ) {
      return routeWorkspaceId;
    }
    return resolveDefaultId(visible, initialWorkspaceId);
  }, [routeWorkspaceId, visible, initialWorkspaceId]);

  const handleSelect = useCallback(
    (id: string) => {
      // Pick a default screen for the target workspace so the URL lands
      // on something renderable instead of `/<workspace>` (workspace-only).
      // First nav-member after qualifying-prefix-strip is a safe pick.
      const target = visible.find((ws) => ws.definition.id === id);
      const firstNavQn = target?.navMembers[0];
      const screenId = firstNavQn !== undefined ? lastSegment(firstNavQn) : "";
      nav.navigate({ workspaceId: id, screenId });
    },
    [nav, visible],
  );

  // Initial sync: covers two URL states that need a default-fill so
  // NavTree links and RoutedScreen have something to chew on.
  //
  //   1. No workspace in URL ("/" or wrong workspace id) → fill the
  //      active workspace AND its first nav-member's screen.
  //   2. Workspace present but screen missing ("/admin") → fill in the
  //      first nav-member's screen, keep the workspace.
  //
  // replace, NOT navigate: these are default-fills, not user actions.
  // Using pushState would create a history entry the user never asked
  // for — Browser-Back from /admin/x → / → effect re-pushes →
  // Back-loop. replaceState swaps in place: Back leaves the app cleanly.
  //
  // useLayoutEffect, NOT useEffect: the children below this shell render
  // RoutedScreen with the URL's current screenId. If that's "" (URL was
  // "/" or "/admin"), KumikoScreen renders a "Screen not found" banner
  // for the empty qn. useEffect would let that banner paint to the
  // screen for one frame before the URL got fixed. useLayoutEffect runs
  // synchronously between commit and paint, so the user only ever sees
  // the resolved screen. (No SSR here, otherwise we'd need a guard.)
  useLayoutEffect(() => {
    if (activeId === undefined) return;
    const routeScreenEmpty = nav.route?.screenId === undefined || nav.route.screenId === "";
    const workspaceMatches = routeWorkspaceId === activeId;
    if (workspaceMatches && !routeScreenEmpty) return; // URL is fine
    const target = visible.find((ws) => ws.definition.id === activeId);
    const firstNavQn = target?.navMembers[0];
    if (firstNavQn === undefined && !routeScreenEmpty) {
      // Workspace exists but no nav members — keep whatever screen the
      // user typed, just lock the workspace prefix.
      nav.replace({ workspaceId: activeId, screenId: nav.route?.screenId ?? "" });
      return;
    }
    if (firstNavQn === undefined) return; // nothing sane to default to
    nav.replace({ workspaceId: activeId, screenId: lastSegment(firstNavQn) });
  }, [activeId, routeWorkspaceId, visible, nav]);

  const activeWorkspace = useMemo(
    () => visible.find((ws) => ws.definition.id === activeId),
    [visible, activeId],
  );

  // Filter resolution has THREE branches and getting them right matters:
  //   * Schema declares workspaces + active resolved → filter to its members
  //   * Schema declares workspaces + NO active visible → empty allow-set
  //     (NOT undefined). This catches the "user has no accessible workspace"
  //     case — falling back to "no filter" would leak nav items the user
  //     shouldn't see, e.g. admin entries to a driver after a role change.
  //   * Schema doesn't declare workspaces at all → undefined (no filter).
  //     Apps that haven't opted into workspaces yet get every nav as before.
  const allowedNavQns = useMemo(() => {
    const hasWorkspaceMode = app.workspaces !== undefined && app.workspaces.length > 0;
    if (!hasWorkspaceMode) return undefined;
    if (activeWorkspace === undefined) return new Set<string>();
    return new Set(activeWorkspace.navMembers);
  }, [app.workspaces, activeWorkspace]);

  const switcher = activeId !== undefined && (
    <WorkspaceSwitcher workspaces={visible} activeId={activeId} onSelect={handleSelect} />
  );

  return (
    <AppLayout
      topbar={<Topbar start={brand} center={switcher || undefined} end={topbarActions} />}
      sidebar={
        <Sidebar {...(sidebarFooter !== undefined && { footer: sidebarFooter })}>
          <NavTree
            schema={app}
            {...(user !== undefined && { user })}
            {...(allowedNavQns !== undefined && { allowedNavQns })}
          />
        </Sidebar>
      }
    >
      {children}
    </AppLayout>
  );
}

// --- helpers (exported for tests) ---

export function filterByAccess(
  workspaces: readonly WorkspaceSchema[],
  userRoles: readonly string[] | undefined,
): readonly WorkspaceSchema[] {
  const roles = userRoles ?? [];
  return [...workspaces]
    .filter((ws) => userMatchesAccess(ws.definition.access, roles))
    .sort(byOrderThenInsertion);
}

function userMatchesAccess(access: AccessRule | undefined, userRoles: readonly string[]): boolean {
  if (access === undefined) return true;
  if ("openToAll" in access) return access.openToAll;
  return access.roles.some((r) => userRoles.includes(r));
}

function byOrderThenInsertion(a: WorkspaceSchema, b: WorkspaceSchema): number {
  // Missing `order` sorts last; ties keep insertion order via stable sort.
  const ao = a.definition.order ?? Number.POSITIVE_INFINITY;
  const bo = b.definition.order ?? Number.POSITIVE_INFINITY;
  return ao - bo;
}

export function resolveDefaultId(
  visible: readonly WorkspaceSchema[],
  preferredShortId: string | undefined,
): string | undefined {
  // 1. Caller-pinned preference (URL or test prop) wins if it's accessible.
  if (preferredShortId !== undefined) {
    const match = visible.find((ws) => ws.definition.id === preferredShortId);
    if (match !== undefined) return match.definition.id;
  }
  // 2. Engine-declared default if accessible.
  const defaulted = visible.find((ws) => ws.definition.default === true);
  if (defaulted !== undefined) return defaulted.definition.id;
  // 3. First workspace the user can see.
  return visible[0]?.definition.id;
}
