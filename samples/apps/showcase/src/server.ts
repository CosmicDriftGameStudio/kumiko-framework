// Dev-Server für den Showcase. runDevApp mit Auth + ein Dev-Tenant.
// Ephemeral DB by default (KUMIKO_DEV_DB_NAME=showcase_demo für
// Persistent).

import { runDevApp } from "@kumiko/dev-server";
import type { TenantId } from "@kumiko/framework/engine";
import { ADMIN_EMAIL, ADMIN_PASSWORD, DEMO_TENANT_ID } from "./auth-constants";
import { showcaseFeature } from "./feature";

await runDevApp({
  features: [showcaseFeature],
  clientEntry: "./src/client.tsx",
  htmlPath: "./public/index.html",
  // Extra Watch-Paths zu den Renderer-Packages: ändert sich primitives/
  // index.tsx oder eine select.tsx, triggert Hot-Reload. Sonst müsste
  // bun beim Renderer-Edit komplett neu gestartet werden — Watcher
  // sieht nur was hier explizit steht.
  watchDirs: [
    "./src",
    "../../../packages/renderer-web/src",
    "../../../packages/renderer/src",
    "../../../packages/headless/src",
    "../../../packages/bundled-features/src/auth-email-password/web",
  ],
  auth: {
    admin: {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      displayName: "Admin",
      memberships: [
        {
          tenantId: DEMO_TENANT_ID as TenantId,
          tenantKey: "demo",
          tenantName: "Demo Tenant",
          roles: ["Admin"],
        },
      ],
    },
  },
});
