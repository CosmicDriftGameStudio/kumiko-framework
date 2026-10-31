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

import { isUiAccessGranted } from "@cosmicdrift/kumiko-framework/ui-types";
import { type ReactNode, useCallback, useLayoutEffect, useMemo } from "react";
import type { AppSchema, FeatureSchema, WorkspaceSchema } from "../../index.ts";
import {
  qualifyNavId,
  toAppSchema,
  UserRolesProvider,
  useNav,
  useTranslation,
} from "../../index.ts";
import { useResolvers } from "../app/resolvers-context.tsx";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
} from "../ui/sidebar.tsx";
import { EditorPanel } from "./editor-panel.tsx";
import { fillClasses } from "./fill-classes.ts";
import { FocusAwareSidebarBody, focusSidebarProviderProps } from "./focus-aware-sidebar.tsx";
import { lastSegment, NavTree } from "./nav-tree.tsx";
import { PageHeaderSlotProvider } from "./page-header-slot.tsx";
import { ShellFocusProvider, useShellFocusHost } from "./shell-focus.tsx";
import { ShellHeader } from "./shell-header.tsx";
import { SidebarPanelProvider, useSidebarPanelHost } from "./sidebar-panel.tsx";
import { parseTargetFromSearchParams } from "./target-url.ts";
import { WorkspaceSwitcher } from "./workspace-switcher.tsx";

export type WorkspaceShellUser = {
  readonly id: string;
  readonly roles: readonly string[];
};

export type WorkspaceShellProps = {
  /** Branding / logo on the left side of the topbar. */
  readonly brand: ReactNode;
  /** Schema with `workspaces` populated — the engine builds this from
   *  registry.getAllWorkspaces() + getWorkspaceNavs(). Accepts
   *  AppSchema (multi-feature) or the legacy FeatureSchema (single-
   *  feature, workspaces inline). Without workspaces, the shell falls
   *  back to a plain NavTree without a switcher. */
  readonly schema: AppSchema | FeatureSchema;
  /** Optional topbar end-slot — TenantSwitcher / ThemeToggle / UserMenu. */
  readonly topbarActions?: ReactNode;
  /** Current user. Drives which workspaces appear in the switcher. */
  readonly user?: WorkspaceShellUser;
  /** Initial active workspace short id ("admin"). When omitted: default
   *  workspace from schema, otherwise first accessible. Useful for SSR
   *  and tests to pre-seed without hitting the URL. */
  readonly initialWorkspaceId?: string;
  /** Footer slot at the bottom of the sidebar — profile row, help link,
   *  build information. It stays at the bottom via `mt-auto` (see
   *  Sidebar.footer). Symmetric with DefaultAppShell.sidebarFooter. */
  readonly sidebarFooter?: ReactNode;
  /** Top-level nav QNs the focus rail shows as tiles; the others sit behind a
   *  "More" tile that opens the full sidebar. Unset: every top-level entry. */
  readonly focusRailNavQns?: readonly string[];
  /** Runtime badge slot per nav leaf (bare nav id), same as DefaultAppShell. */
  readonly navBadges?: ReadonlyMap<string, ReactNode>;
  /** Viewport-fit shell. true → fixed viewport height (`h-svh`), content
   *  scrolls INSIDE instead of the whole page. Default true — set
   *  `fill={false}` to opt back into page scroll. */
  readonly fill?: boolean;
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
  focusRailNavQns,
  navBadges,
  fill = true,
  children,
}: WorkspaceShellProps): ReactNode {
  const app = useMemo(() => toAppSchema(schema), [schema]);
  const visible = useMemo<readonly WorkspaceSchema[]>(
    () => filterByAccess(app.workspaces ?? [], user?.roles),
    [app.workspaces, user?.roles],
  );

  const nav = useNav();
  const t = useTranslation();
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
      // Pick the first nav-member that actually points at a screen so
      // the URL lands on something renderable instead of `/<workspace>`.
      // Section headers (nav entries without `screen`) are skipped.
      const target = visible.find((ws) => ws.definition.id === id);
      const screenId = firstNavScreenId(app, target?.navMembers);
      nav.navigate({ workspaceId: id, screenId });
    },
    [nav, app, visible],
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
    const navMembers = target?.navMembers;
    if ((navMembers === undefined || navMembers.length === 0) && !routeScreenEmpty) {
      // Workspace exists but no nav members — keep whatever screen the
      // user typed, just lock the workspace prefix.
      nav.replace({ workspaceId: activeId, screenId: nav.route?.screenId ?? "" });
      return;
    }
    const screenId = firstNavScreenId(app, navMembers);
    // Loop guard: if none of the nav-members has a screen property
    // (all are section headers or unknown QNs), nav.replace with
    // screenId="" would fire the effect again on every re-render and pin
    // the user to "/<workspace>/". Do not replace in that case — the
    // workspace selector can then send the user to a leaf nav manually.
    if (screenId === "") return;
    nav.replace({ workspaceId: activeId, screenId });
  }, [activeId, routeWorkspaceId, visible, nav, app]);

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

  // One Nav: always NavTree. Dynamic nodes (r.nav({ provider: true }))
  // load their children client-side from the registered navProviders —
  // the former navigation:"tree"/VisualTree branch is folded in here.
  // In the content area, an active target (from nav.searchParams, set
  // when a target node is clicked) renders EditorPanel instead of
  // RoutedScreen; otherwise it renders the regular screen children.
  // (WorkspaceDefinition.navigation has been a no-op since then; removal deferred.)
  const resolvers = useResolvers();
  const activeTarget = parseTargetFromSearchParams(nav.searchParams);

  const sidebarContent = (
    <NavTree
      schema={app}
      {...(user !== undefined && { user })}
      {...(allowedNavQns !== undefined && { allowedNavQns })}
      {...(navBadges !== undefined && { navBadges })}
    />
  );

  // Modern shell (like DefaultAppShell): collapsible icon-rail sidebar
  // carries brand + workspace switcher + nav + footer; the SidebarInset
  // renders the shared ShellHeader (panel toggle + breadcrumb + actions)
  // above the content. topbarActions render right inside the header row
  // instead of a separate topbar — one header line, not two.
  const fillCls = fillClasses(fill);
  // The second column appears only when a screen fills it (sidebar-09 pattern);
  // otherwise every other screen would have an empty strip beside the navigation.
  const panel = useSidebarPanelHost();
  const focus = useShellFocusHost();
  return (
    <SidebarProvider {...fillCls.provider} {...focusSidebarProviderProps(focus)}>
      <ShellFocusProvider value={focus.value}>
        <SidebarPanelProvider value={panel.value}>
          <Sidebar
            collapsible="icon"
            mobileTitle={t("kumiko.sidebar.title")}
            mobileDescription={t("kumiko.sidebar.description")}
          >
            <FocusAwareSidebarBody
              focused={focus.focused}
              brand={brand}
              schema={app}
              user={user}
              allowedNavQns={allowedNavQns}
              railNavQns={focusRailNavQns}
              footer={sidebarFooter}
            >
              <SidebarHeader data-kumiko-layout="sidebar-header">
                {brand}
                {switcher}
              </SidebarHeader>
              <SidebarContent data-kumiko-layout="sidebar-nav">{sidebarContent}</SidebarContent>
              {sidebarFooter !== undefined && (
                <SidebarFooter
                  data-kumiko-layout="sidebar-footer"
                  className="border-t border-sidebar-border"
                >
                  {sidebarFooter}
                </SidebarFooter>
              )}
            </FocusAwareSidebarBody>
            <SidebarRail
              aria-label={t("kumiko.sidebar.toggle")}
              title={t("kumiko.sidebar.toggle")}
            />
          </Sidebar>
          <div
            ref={panel.ref}
            data-kumiko-layout="sidebar-panel"
            className={panel.occupied ? "flex h-svh shrink-0 flex-col" : "hidden"}
          />
          <SidebarInset className={fillCls.inset}>
            <PageHeaderSlotProvider>
              <ShellHeader
                schema={app}
                {...(user !== undefined && { user })}
                {...(allowedNavQns !== undefined && { allowedNavQns })}
                {...(topbarActions !== undefined && { headerActions: topbarActions })}
              />
              <main className={fillCls.main}>
                {activeTarget !== undefined ? (
                  <EditorPanel resolvers={resolvers} />
                ) : (
                  <UserRolesProvider roles={user?.roles}>{children}</UserRolesProvider>
                )}
              </main>
            </PageHeaderSlotProvider>
          </SidebarInset>
        </SidebarPanelProvider>
      </ShellFocusProvider>
    </SidebarProvider>
  );
}

// --- helpers (exported for tests) ---

export function filterByAccess(
  workspaces: readonly WorkspaceSchema[],
  userRoles: readonly string[] | undefined,
): readonly WorkspaceSchema[] {
  return [...workspaces]
    .filter((ws) => isUiAccessGranted(ws.definition.access, userRoles))
    .sort(byOrderThenInsertion);
}

function byOrderThenInsertion(a: WorkspaceSchema, b: WorkspaceSchema): number {
  // Missing `order` sorts last; ties keep insertion order via stable sort.
  const ao = a.definition.order ?? Number.POSITIVE_INFINITY;
  const bo = b.definition.order ?? Number.POSITIVE_INFINITY;
  return ao - bo;
}

/** Returns the short screen-id of the first nav-member that points at
 *  a screen. Walks the workspace's nav-list in order and skips section
 *  headers (NavDefinitions without `screen`) so a workspace whose first
 *  member is a header still resolves to a renderable screen.
 *
 *  Returns "" when:
 *    - navMembers is undefined or empty
 *    - all members are section headers (no `screen` property)
 *    - all members are unknown to the schema (drift between
 *      r.workspace.nav and the registered navs — the boot validator catches
 *      this server-side; this is only a graceful fallback)
 *
 *  The caller MUST loop-guard on "": rendering with screenId="" makes
 *  KumikoScreen show the not-found banner — and nav.replace with an empty
 *  screenId would fire the useLayoutEffect in WorkspaceShell on every
 *  re-render (see the matching guard there).
 *
 *  Earlier code used `lastSegment(navQn)`, which only worked when the
 *  feature followed the convention nav.id === screen.id (samples/apps/
 *  workspaces does this). Apps with distinct ids (publicstatus: nav
 *  "components" → screen "component-list") got "Screen not found".
 *
 *  Exported for edge-case tests. */
export function firstNavScreenId(
  app: AppSchema,
  navMembers: readonly string[] | undefined,
): string {
  if (navMembers === undefined || navMembers.length === 0) return "";
  for (const navQn of navMembers) {
    for (const feature of app.features) {
      for (const nav of feature.navs ?? []) {
        if (qualifyNavId(feature.featureName, nav.id) !== navQn) continue;
        if (nav.screen === undefined) break; // section-header → next member
        return lastSegment(nav.screen);
      }
    }
  }
  return "";
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
