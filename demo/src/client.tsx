// Browser entry. runDevApp's clientEntry option bundles this file to
// /client.js and the default HTML loads it. createKumikoApp fetches the
// AppSchema itself from the authenticated GET /api/schema (once the auth
// gate lets rendering through) and mounts the routes.
//
// DefaultAppShell supplies the sidebar + topbar — without `shell`,
// createKumikoApp renders the active screen without a layout wrapper (=
// after login just a bare banner instead of the app). emailPasswordClient()
// brings the login screen + session provider — without it /login stays empty.
//
// Add new client plugins (e.g. notificationsClient()) here in clientFeatures
// — symmetric to APP_FEATURES on the server side.

import { emailPasswordClient } from "@cosmicdrift/kumiko-bundled-features/auth-email-password/web";
import { localeDeClient } from "@cosmicdrift/kumiko-locale-de/web";
import { type AppSchema, createKumikoApp, DefaultAppShell } from "@cosmicdrift/kumiko-renderer-web";
import type { ReactNode } from "react";

// createKumikoApp's shell option only injects schema + children, so brand is supplied here.
function AppShell({ children, schema }: { children: ReactNode; schema: AppSchema }): ReactNode {
  return (
    <DefaultAppShell
      brand={<span className="font-semibold tracking-tight">demo</span>}
      schema={schema}
    >
      {children}
    </DefaultAppShell>
  );
}

createKumikoApp({
  shell: AppShell,
  clientFeatures: [localeDeClient(), emailPasswordClient()],
});
