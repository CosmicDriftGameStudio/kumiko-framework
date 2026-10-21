// Reads the logged-in user and roles for the active tenant from the session.
// This hook is the standard bridge between session state and layout components
// (WorkspaceShell.user, DefaultAppShell gates, custom permission checks).
//
// Returns undefined while:
//   - the session is loading (status="loading")
//   - the user is unauthenticated
//   - activeTenantId is missing from the tenants list (a defensive path that
//     should not occur, but is harmless to check)
//
// WorkspaceShell and DefaultAppShell treat undefined as "no workspaces
// visible", which is the correct UX while loading or logged out. Apps that
// need more (such as a loading indicator) should check useSession().status
// directly.

import { useMemo } from "react";
import { useSession } from "./session.tsx";

export type ShellUser = {
  readonly id: string;
  readonly roles: readonly string[];
};

export function useShellUser(): ShellUser | undefined {
  const session = useSession();
  return useMemo(() => {
    if (session.status !== "authenticated" || session.user === null) return undefined;
    const activeTenant = session.tenants.find((t) => t.tenantId === session.activeTenantId);
    if (activeTenant === undefined) return undefined;
    // session.roles merges globalRoles (e.g. SystemAdmin) + membership — same
    // merge the server uses for handler access; membership-only broke platform
    // workspace gating for global operators.
    return { id: session.user.id, roles: session.roles };
  }, [session.status, session.user, session.activeTenantId, session.tenants, session.roles]);
}
