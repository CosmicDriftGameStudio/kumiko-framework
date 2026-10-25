// @runtime dev
//
// Dev server for ui-walkthrough. runDevApp mixes in the standard features
// (config/user/tenant/auth) automatically when `auth` is set and
// calls seedAdmin in onAfterSetup. The schema lands in the browser as a
// window.__KUMIKO_SCHEMA__ injection.
//
// Auth mode active: the client must log in via the login screen,
// no more auto-mint JWT. Persistent DB mode via KUMIKO_DEV_DB_NAME
// in the environment.

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

// Two fixed tenants — the admin is a member of both so the
// TenantSwitcher is visible in the sample (renders only with >1 tenant).
// Different roles per tenant prove tenant-isolated
// memberships. TenantId cast local at the use site (auth-constants.ts
// stays framework-free for the E2E helper path).

await runDevApp({
  features: [...APP_FEATURES],
  seeds: [seedTasks, seedRental, seedVehicles, seedTemplates, seedPlanTerms],
  // PORT env var override for Playwright e2e runs (config points to 4174);
  // otherwise local default 4173.
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
