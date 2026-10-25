// Dev bootstrap. `bun --watch bin/dev.ts` (see package.json scripts.dev)
// starts a full-featured dev server that reloads on code changes.
// setupTestStack creates missing entity tables on boot, so a new
// r.entity(...) becomes a CREATE TABLE on the next reboot without a manual
// `kumiko schema apply` (that step only applies to prod).
// KUMIKO_DEV_DB_NAME (.env) keeps the DB persistent so the admin and data survive reboots.

import { runDevApp } from "@cosmicdrift/kumiko-dev-server";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { APP_FEATURES } from "../src/run-config";
import { seedDemoTasks } from "../src/seed";

const DEFAULT_TENANT_ID = "aefd3536-85bf-485b-b325-00006f8a57a1" as TenantId;
await runDevApp({
  features: APP_FEATURES,
  welcomeBanner: true,
  clientEntry: "./src/client.tsx",
  seeds: [seedDemoTasks],
  auth: {
    admin: {
      email: "admin@demo.local",
      password: "changeme",
      displayName: "Admin",
      memberships: [
        {
          tenantId: DEFAULT_TENANT_ID,
          tenantKey: "demo",
          tenantName: "demo",
          roles: ["TenantAdmin"],
        },
      ],
    },
  },
});
