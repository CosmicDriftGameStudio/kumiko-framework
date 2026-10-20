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

import { createUnsubscribeRoutes } from "@cosmicdrift/kumiko-bundled-features/delivery";
import { runDevApp } from "@cosmicdrift/kumiko-dev-server";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { createInMemoryFileProvider } from "@cosmicdrift/kumiko-framework/files";
import { seedPlanTerms } from "../features/subscription-plans";
import { APP_FEATURES } from "../run-config";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  BETA_TENANT_ID,
  DEV_TENANT_ID,
  UNSUBSCRIBE_SECRET,
} from "./auth-constants";
import { seedTasks } from "./seed";
import { seedRental } from "./seed-rental";
import { seedTemplates } from "./seed-templates";
import { seedVehicles } from "./seed-vehicles";

// Zwei feste Tenants — Admin ist in beiden Mitglied damit der
// TenantSwitcher im Sample sichtbar ist (rendert nur bei >1 Tenant).
// Unterschiedliche Rollen pro Tenant beweisen tenant-isolierte
// Memberships. TenantId-Cast lokal an der Use-Site (auth-constants.ts
// bleibt framework-frei für den E2E-Helper-Pfad).

await runDevApp({
  features: [...APP_FEATURES],
  seeds: [seedTasks, seedRental, seedVehicles, seedTemplates, seedPlanTerms],
  // PORT env-var override für Playwright-e2e-Runs (config zeigt auf 4174);
  // sonst lokal-Default 4173.
  port: Number.parseInt(process.env["PORT"] ?? "4173", 10),
  // Logo and attachment uploads of the mail editor need a file store.
  files: { storageProvider: createInMemoryFileProvider() },
  // The pages behind a mail's unsubscribe link, dressed in the tenant's mail look.
  extraRoutes: createUnsubscribeRoutes({ secret: UNSUBSCRIBE_SECRET }),
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
