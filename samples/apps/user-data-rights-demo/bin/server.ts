// Local dev-server fuer das user-data-rights-demo Sample.
//
// Demo-Story: User legt Todos an, ruft request-export auf, kriegt einen
// signed Magic-Link auf seine Mailadresse. ZIP enthaelt user-Profil +
// fileRefs + todos. Plus request-deletion mit 30-day-grace.
//
// Vorbedingungen (siehe README): Postgres + Redis via `yarn kumiko dev`.

import { runDevApp } from "@cosmicdrift/kumiko-dev-server";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { APP_FEATURES } from "../src/run-config";

const DEMO_TENANT_ID = "00000000-0000-4000-8000-000000000021" as TenantId;
const port = Number.parseInt(process.env["PORT"] ?? "4291", 10);

await runDevApp({
  features: APP_FEATURES,
  port,
  watchDirs: ["./src", "./bin"],
  auth: {
    admin: {
      email: "admin@user-data-rights.local",
      password: "changeme",
      displayName: "DSGVO-Demo Admin",
      memberships: [
        {
          tenantId: DEMO_TENANT_ID,
          tenantKey: "demo",
          tenantName: "User-Data-Rights Demo",
          roles: ["Admin", "TenantAdmin"],
        },
      ],
    },
  },
});
