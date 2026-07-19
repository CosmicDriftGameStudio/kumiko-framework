import { createContext, type ReactNode, useContext } from "react";

// Threads the current user's roles through the tree so KumikoScreen can
// gate role-restricted screens at render time (see #1203 — nav filtering
// alone doesn't stop a direct-URL/screenQn hit on a role-gated screen).
// Apps wire this from their `shell` render-prop, the same place they
// already pass `user` to WorkspaceShell for nav filtering.
//
// undefined (no provider mounted, or `roles` not passed) means "roles
// unknown" — deliberately distinct from `[]` ("authenticated, no
// roles"). Both deny role-gated screens; only `undefined` also lets an
// app without any role-gated screens skip wiring this entirely.

const UserRolesContext = createContext<readonly string[] | undefined>(undefined);

export type UserRolesProviderProps = {
  readonly roles: readonly string[] | undefined;
  readonly children: ReactNode;
};

export function UserRolesProvider({ roles, children }: UserRolesProviderProps): ReactNode {
  return <UserRolesContext value={roles}>{children}</UserRolesContext>;
}

export function useUserRoles(): readonly string[] | undefined {
  return useContext(UserRolesContext);
}
