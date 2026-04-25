// WorkspaceShell — App-shell for multi-persona apps. Renders the
// switcher in the topbar center slot, picks the active workspace from
// URL state (?w=<id>) or default, and feeds the active workspace's
// nav-membership down to NavTree as an allow-set.
//
// Apps that don't need workspaces stick with DefaultAppShell. Both
// shells live side-by-side; createKumikoApp's `shell` prop picks one.
//
// Active-workspace resolution priority:
//   1. URL ?w=<workspaceShortId>            (user-driven, shareable)
//   2. `initialWorkspaceId` prop             (caller-pinned, e.g. SSR/test)
//   3. WorkspaceDefinition with default:true (engine-validated unique)
//   4. First workspace the user has access to
//
// State lives in the URL (?w=) as the single source of truth via
// `useBrowserWorkspaceQuery`. No local React state — tenant-switches and
// role refreshes heal automatically: `visible` recomputes, the URL id no
// longer matches a visible workspace, and the resolution chain falls
// through to the default. Reloads / bookmarks / shared links keep the
// active workspace because the URL carries it.
//
// Followup: `nav.tsx#pushPath` currently overwrites the search part on
// every navigate(), which drops `?w=` on a sidebar click. Fixing that
// preserves workspace state across nav events; until then the user
// snaps back to the default after each click.
//
// Roles gating:
//   * access.openToAll → always shown
//   * access.roles     → shown only when user.roles ∩ access.roles ≠ ∅
//   * access undefined → shown to everyone (engine convention — same
//                        rule that NavDefinition.access follows)

import type { AccessRule } from "@kumiko/framework/ui-types";
import type { FeatureSchema, WorkspaceSchema } from "@kumiko/renderer";
import { type ReactNode, useCallback, useMemo } from "react";
import { useBrowserWorkspaceQuery } from "../app/workspace";
import { AppLayout } from "./app-layout";
import { NavTree } from "./nav-tree";
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
  /** Schema with .workspaces populated — the engine builds this from
   *  registry.getAllWorkspaces() + getWorkspaceNavs(). When empty,
   *  WorkspaceShell falls back to plain NavTree without a switcher. */
  readonly schema: FeatureSchema;
  /** Optional topbar end-slot — TenantSwitcher / ThemeToggle / UserMenu. */
  readonly topbarActions?: ReactNode;
  /** Current user. Drives which workspaces appear in the switcher. */
  readonly user?: WorkspaceShellUser;
  /** Initial active workspace short id ("admin"). When omitted: default
   *  workspace from schema, otherwise first accessible. Useful for SSR
   *  and tests to pre-seed without hitting the URL. */
  readonly initialWorkspaceId?: string;
  /** Screen content. */
  readonly children: ReactNode;
};

export function WorkspaceShell({
  brand,
  schema,
  topbarActions,
  user,
  initialWorkspaceId,
  children,
}: WorkspaceShellProps): ReactNode {
  const visible = useMemo<readonly WorkspaceSchema[]>(
    () => filterByAccess(schema.workspaces ?? [], user?.roles),
    [schema.workspaces, user?.roles],
  );

  const [urlId, setUrlId] = useBrowserWorkspaceQuery();

  // Single source of truth: URL > initial > engine-default > first visible.
  // Recomputed on every dependency change — no local state, no stale-id
  // healing useEffect. If urlId points at a workspace the user can no
  // longer access (e.g. after a tenant-switch), the chain falls through
  // to the resolveDefaultId fallback.
  const activeId = useMemo(() => {
    if (urlId !== undefined && visible.some((ws) => ws.definition.id === urlId)) {
      return urlId;
    }
    return resolveDefaultId(visible, initialWorkspaceId);
  }, [urlId, visible, initialWorkspaceId]);

  const handleSelect = useCallback((id: string) => setUrlId(id), [setUrlId]);

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
    const hasWorkspaceMode =
      schema.workspaces !== undefined && schema.workspaces.length > 0;
    if (!hasWorkspaceMode) return undefined;
    if (activeWorkspace === undefined) return new Set<string>();
    return new Set(activeWorkspace.navMembers);
  }, [schema.workspaces, activeWorkspace]);

  const switcher = activeId !== undefined && (
    <WorkspaceSwitcher workspaces={visible} activeId={activeId} onSelect={handleSelect} />
  );

  return (
    <AppLayout
      topbar={<Topbar start={brand} center={switcher || undefined} end={topbarActions} />}
      sidebar={
        <Sidebar>
          <NavTree
            schema={schema}
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

function userMatchesAccess(
  access: AccessRule | undefined,
  userRoles: readonly string[],
): boolean {
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

