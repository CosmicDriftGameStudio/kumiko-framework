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
  watchDirs: ["./src"],
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
