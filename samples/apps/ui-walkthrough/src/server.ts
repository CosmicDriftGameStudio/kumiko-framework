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
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./auth-constants";
import { taskFeature } from "./feature";

// Zwei feste Tenants — Admin ist in beiden Mitglied damit der
// TenantSwitcher im Sample sichtbar ist (rendert nur bei >1 Tenant).
// Unterschiedliche Rollen pro Tenant beweisen tenant-isolierte
// Memberships. IDs gespiegelt im client.tsx (siehe Kommentar dort).
const DEV_TENANT_ID = "00000000-0000-4000-8000-000000000001" as TenantId;
const BETA_TENANT_ID = "00000000-0000-4000-8000-000000000002" as TenantId;

await runDevApp({
  features: [taskFeature],
  clientEntry: "./src/client.tsx",
  htmlPath: "./public/index.html",
  watchDirs: ["./src"],
  auth: {
    admin: {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      displayName: "Admin",
      memberships: [
        { tenantId: DEV_TENANT_ID, tenantKey: "dev", tenantName: "Dev Tenant", roles: ["Admin"] },
        { tenantId: BETA_TENANT_ID, tenantKey: "beta", tenantName: "Beta Tenant", roles: ["User"] },
      ],
    },
  },
});
