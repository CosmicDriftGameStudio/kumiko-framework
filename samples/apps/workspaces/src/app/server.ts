// @runtime dev
//
// Dev-server für den workspaces Sample. Auth-Mode aktiv: der Client
// muss sich über den Login-Screen anmelden. WorkspaceShell filtert dann
// nach `user.roles` aus der Session — Admin sieht alle drei, andere
// Rollen nur ihre.
//
// runDevApp mischt die Standard-Features (config/user/tenant/auth)
// automatisch dazu wenn `auth` gesetzt ist und ruft seedAdmin im
// onAfterSetup. Schema landet als window.__KUMIKO_SCHEMA__-Injection
// im Browser, kein hand-geschriebener clientSchema-Spiegel.

import { runDevApp } from "@kumiko/dev-server";
import type { TenantId } from "@kumiko/framework/engine";
import { demoFeature } from "../features/demo";
import { driverFeature } from "../features/demo-driver";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./auth-constants";

// Ein Dev-Tenant reicht — die Workspaces filtern nach `roles` (nicht
// nach Tenant). Wer Tenant-Switching demoen will, schaut in den
// ui-walkthrough-Sample.
const DEV_TENANT_ID = "00000000-0000-4000-8000-000000000010" as TenantId;

await runDevApp({
  features: [demoFeature, driverFeature],
  port: 4174,
  clientEntry: "./src/app/client.tsx",
  htmlPath: "./public/index.html",
  watchDirs: ["./src", "../../../packages/*/src"],
  auth: {
    admin: {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      displayName: "Admin",
      // Admin-Rolle gibt Zugriff auf alle drei Workspaces (admin/dispatch/
      // driver). Realwelt-Apps würden weitere Rollen + User definieren.
      memberships: [
        { tenantId: DEV_TENANT_ID, tenantKey: "dev", tenantName: "Dev Tenant", roles: ["Admin"] },
      ],
    },
  },
});
