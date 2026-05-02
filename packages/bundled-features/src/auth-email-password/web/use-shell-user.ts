// @runtime client
// Liest den eingeloggten User + die Rollen aus dem aktiven Tenant aus
// der Session. Der Hook ist die Standard-Brücke zwischen Session-State
// und Layout-Komponenten (WorkspaceShell.user, DefaultAppShell-Gates,
// custom permission checks).
//
// Returns undefined solange:
//   - die Session lädt (status="loading")
//   - der User unauthenticated ist
//   - der activeTenantId in der tenants-Liste fehlt (defensiver Pfad —
//     sollte nicht passieren, schadet aber nicht zu prüfen)
//
// WorkspaceShell + DefaultAppShell akzeptieren undefined als "keine
// Workspaces sichtbar", was im Loading-/Logged-Out-Fall die richtige UX
// ist. Apps die mehr brauchen (Loading-Indicator etc.) prüfen
// useSession().status direkt.

import { useMemo } from "react";
import { useSession } from "./session";

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
    return { id: session.user.id, roles: activeTenant.roles };
  }, [session.status, session.user, session.activeTenantId, session.tenants]);
}
