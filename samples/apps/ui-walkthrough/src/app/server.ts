// @runtime dev
//
// Dev-Server für ui-walkthrough. runDevApp mischt die Standard-Features
// (config/user/tenant/auth) automatisch dazu wenn `auth` gesetzt ist und
// ruft seedAdmin im onAfterSetup. Schema landet als window.__KUMIKO_
// SCHEMA__-Injection im Browser.
//
// Auth-Mode aktiv: Client muss sich über den Login-Screen anmelden,
// kein Auto-Mint-JWT mehr. Persistent-DB-Modus über KUMIKO_DEV_DB_NAME
// in der Umgebung.

import { runDevApp } from "@kumiko/dev-server";
import type { TenantId } from "@kumiko/framework/engine";
import { taskFeature } from "../features/tasks";
import { ADMIN_EMAIL, ADMIN_PASSWORD, BETA_TENANT_ID, DEV_TENANT_ID } from "./auth-constants";

// Zwei feste Tenants — Admin ist in beiden Mitglied damit der
// TenantSwitcher im Sample sichtbar ist (rendert nur bei >1 Tenant).
// Unterschiedliche Rollen pro Tenant beweisen tenant-isolierte
// Memberships. TenantId-Cast lokal an der Use-Site (auth-constants.ts
// bleibt framework-frei für den E2E-Helper-Pfad).

await runDevApp({
  features: [taskFeature],
  port: 4173,
  clientEntry: "./src/app/client.tsx",
  htmlPath: "./public/index.html",
  watchDirs: ["./src", "../../../packages/*/src"],
  auth: {
    admin: {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      displayName: "Admin",
      memberships: [
        {
          tenantId: DEV_TENANT_ID as TenantId,
          tenantKey: "dev",
          tenantName: "Dev Tenant",
          roles: ["Admin"],
        },
        {
          tenantId: BETA_TENANT_ID as TenantId,
          tenantKey: "beta",
          tenantName: "Beta Tenant",
          roles: ["User"],
        },
      ],
    },
  },
});
