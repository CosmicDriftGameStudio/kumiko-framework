// Local dev-server für das cap-billing-demo Sample.
//
// Demo-Story: Newsletter-Send mit per-Tier-Cap (free=10/month, pro=
// 100/month). Mails landen im in-memory-transport, abrufbar über die
// Helper aus @kumiko/bundled-features/mail-transport-inmemory.
//
// Vorbedingungen (siehe README): Postgres + Redis via `yarn kumiko dev`;
// Migrations via `yarn kumiko migrate apply` (aktuell nur die Default-
// Tabellen — das Demo nutzt keine eigene Entity-Projektion).

import { runDevApp } from "@kumiko/dev-server";
import type { TenantId } from "@kumiko/framework/engine";
import { APP_FEATURES } from "../src/run-config";

const DEMO_TENANT_ID = "00000000-0000-4000-8000-000000000020" as TenantId;
const port = Number.parseInt(process.env["PORT"] ?? "4290", 10);

await runDevApp({
  features: APP_FEATURES,
  port,
  watchDirs: ["./src", "./bin"],
  auth: {
    admin: {
      email: "admin@cap-demo.local",
      password: "changeme",
      displayName: "Cap-Demo Admin",
      memberships: [
        {
          tenantId: DEMO_TENANT_ID,
          tenantKey: "demo",
          tenantName: "Cap-Billing-Demo",
          roles: ["Admin", "TenantAdmin"],
        },
      ],
    },
  },
});
