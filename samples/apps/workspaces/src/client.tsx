// Browser entrypoint. Mounts WorkspaceShell — die Alternative zu
// DefaultAppShell mit Persona-Switcher + per-Workspace Nav-Tree-Filter.
// Active Workspace lebt in der URL (/<workspace>/<screen>) damit
// Reload/Bookmark/Shared-Link auf der gleichen Surface landen.
//
// emailPasswordClient() bringt SessionProvider + AuthGate mit — der Gate
// sperrt den Tree solange unauthenticated und rendert den LoginScreen.
// useShellUser leitet aus der Session { id, roles } ab; WorkspaceShell
// filtert die sichtbaren Workspaces nach `access.roles`.
//
// Schema: dev-server injiziert es beim Boot als window.__KUMIKO_SCHEMA__,
// createKumikoApp liest es ohne Argument-Pass-Through und reicht's an
// die Shell weiter.

import {
  DefaultTopbarActions,
  emailPasswordClient,
  useShellUser,
} from "@kumiko/bundled-features/auth-email-password/web";
import {
  type AppSchema,
  type ClientFeatureDefinition,
  createKumikoApp,
  WorkspaceShell,
} from "@kumiko/renderer-web";
import { MoonStar, Sun } from "lucide-react";
import type { ReactNode } from "react";

const APP_NAME = "Kumiko Workspaces Demo";

// i18n bundles für die Workspace- + Nav-Labels. Ohne diese Bundles
// rendert NavTree den raw key ("demo:workspace.admin") statt einer
// menschlichen Beschriftung.
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
      topbarActions={
        <DefaultTopbarActions
          lightIcon={<Sun className="h-4 w-4" />}
          darkIcon={<MoonStar className="h-4 w-4" />}
        />
      }
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
