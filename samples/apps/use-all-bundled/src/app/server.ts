// @runtime dev
//
// Dev-/Screenshot-Server für das use-all-bundled Sample. runDevApp mischt im
// auth-Mode die 4 Standard-Features (config/user/tenant/auth) automatisch via
// composeFeatures(includeBundled) dazu — exakt die 4, die APP_FEATURES bewusst
// auslässt — und seedet den Admin im onAfterSetup. So rendert EINE App alle
// bundled-feature-Screens für die Doku-Previews.
//
// globalRoles SystemAdmin: schaltet die Plattform-Screens frei (tenant-list,
// user-list, tier-admin, GDPR-Inspector). anonymousAccess + extraContext.text
// Content: die öffentlichen legal-pages-Routen (/legal/*).

import { createTextContentApi } from "@cosmicdrift/kumiko-bundled-features/text-content";
import { runDevApp } from "@cosmicdrift/kumiko-dev-server";
import { SYSTEM_TENANT_ID, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { APP_FEATURES } from "../run-config";
import { ADMIN_EMAIL, ADMIN_PASSWORD, BETA_TENANT_ID, DEV_TENANT_ID } from "./auth-constants";
import { appScreensFeature } from "./screens-feature";
import { seedScreenshotData } from "./seed";

// tier-admin rendert mit dem bare tierEngineFeature (aus APP_FEATURES) den
// ehrlichen Empty-State ("no TierMap configured"). Eine konfigurierte tierMap
// würde den Resolver auf jedem Write aktivieren (inkl. Login) und braucht
// per-Tenant Tier-Assignments — disproportional für einen Preview-Screenshot.

await runDevApp({
  features: [...APP_FEATURES, appScreensFeature],
  port: Number.parseInt(process.env["PORT"] ?? "4186", 10),
  clientEntry: "./src/app/client.tsx",
  htmlPath: "./public/index.html",
  watchDirs: ["./src", "../../../packages/*/src"],
  anonymousAccess: { defaultTenantId: SYSTEM_TENANT_ID },
  extraContext: ({ db }) => ({ textContent: createTextContentApi(db) }),
  seeds: [seedScreenshotData],
  auth: {
    admin: {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      displayName: "Admin",
      // Platform-operator: schaltet die SystemAdmin-gegateten Screens frei.
      globalRoles: ["SystemAdmin"],
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
