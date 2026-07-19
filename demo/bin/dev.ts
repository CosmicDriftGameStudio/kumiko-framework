// Dev-bootstrap. `bun --watch bin/dev.ts` (siehe package.json scripts.dev)
// startet einen full-featured Dev-Server mit Auto-Reload bei Code-Änderungen.
// setupTestStack legt fehlende Entity-Tabellen automatisch an — neues
// r.entity(...) in einem Feature führt beim nächsten Reboot zu CREATE TABLE,
// kein manuelles `kumiko schema apply` nötig (das gilt nur für Prod).
// Persistent-DB via KUMIKO_DEV_DB_NAME (.env) damit Admin + Daten Reboots überleben.

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
