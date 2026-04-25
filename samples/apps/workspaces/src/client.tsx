// Browser entrypoint. Mounts WorkspaceShell — the alternative to
// DefaultAppShell that adds a persona switcher + per-workspace nav-tree
// filtering. Active workspace lives in the URL (/<workspace>/<screen>)
// so reload/bookmark/shared link keep the user on the same surface.
//
// Auth: emailPasswordClient() bringt SessionProvider + AuthGate mit. Der
// AuthGate rendert den LoginScreen wenn unauthenticated, und gibt erst
// nach erfolgreichem Login die Children frei. WorkspaceShell liest dann
// die Rolle aus useSession() und filtert die sichtbaren Workspaces nach
// `access.roles`.
//
// Schema: kein clientSchema-Import — dev-server resolved das AppSchema
// beim Boot und injiziert es als window.__KUMIKO_SCHEMA__. createKumikoApp
// liest's und reicht's via shell-prop weiter.

import {
  emailPasswordClient,
  TenantSwitcher,
  UserMenu,
  useSession,
} from "@kumiko/bundled-features/auth-email-password/web";
import {
  type AppSchema,
  type ClientFeatureDefinition,
  createKumikoApp,
  ThemeToggle,
  WorkspaceShell,
} from "@kumiko/renderer-web";
import { MoonStar, Sun } from "lucide-react";
import { type ReactNode, useMemo } from "react";

const APP_NAME = "Kumiko Workspaces Demo";

// i18n bundles. Workspace + nav labels are i18n keys; without these
// bundles the renderer would show the raw "demo:workspace.admin" key.
const appClientFeature: ClientFeatureDefinition = {
  name: "workspaces-demo",
  translations: {
    de: {
      "demo:workspace.admin": "System-Admin",
      "demo:workspace.dispatch": "Cockpit",
      "demo:workspace.driver": "Fahrer",
      "demo:nav.orderList": "Aufträge",
      "demo:nav.orderNew": "Neuer Auftrag",
      "demo:nav.auditLog": "Audit-Log",
      "demo-driver:nav.myTour": "Meine Tour",
    },
    en: {
      "demo:workspace.admin": "Admin",
      "demo:workspace.dispatch": "Dispatch",
      "demo:workspace.driver": "Driver",
      "demo:nav.orderList": "Orders",
      "demo:nav.orderNew": "New order",
      "demo:nav.auditLog": "Audit Log",
      "demo-driver:nav.myTour": "My tour",
    },
  },
};

const Brand = (): ReactNode => (
  <strong className="text-foreground tracking-tight">{APP_NAME}</strong>
);

const TopbarActions = (): ReactNode => (
  <div className="flex items-center gap-2">
    <TenantSwitcher />
    <ThemeToggle
      lightIcon={<Sun className="h-4 w-4" />}
      darkIcon={<MoonStar className="h-4 w-4" />}
    />
    <UserMenu />
  </div>
);

// Liest den aktuellen User + die Rollen aus dem aktiven Tenant. Returns
// undefined solange die Session lädt oder unauthenticated ist — der
// AuthGate sperrt den Rest des Trees ohnehin in dem Fall, aber
// WorkspaceShell soll auch bei kurzlebiger Loading-Phase nicht mit
// stale roles rendern.
function useShellUser(): { id: string; roles: readonly string[] } | undefined {
  const session = useSession();
  return useMemo(() => {
    if (session.status !== "authenticated" || session.user === null) return undefined;
    const activeTenant = session.tenants.find((t) => t.tenantId === session.activeTenantId);
    if (activeTenant === undefined) return undefined;
    return { id: session.user.id, roles: activeTenant.roles };
  }, [session.status, session.user, session.activeTenantId, session.tenants]);
}

const AppShell = ({
  children,
  schema,
}: {
  readonly children: ReactNode;
  readonly schema: AppSchema;
}): ReactNode => {
  const user = useShellUser();
  return (
    <WorkspaceShell
      brand={<Brand />}
      schema={schema}
      topbarActions={<TopbarActions />}
      {...(user !== undefined && { user })}
    >
      {children}
    </WorkspaceShell>
  );
};

createKumikoApp({
  shell: AppShell,
  clientFeatures: [emailPasswordClient(), appClientFeature],
});
