// Local dev server for the cap-billing-demo sample.
//
// Demo story: newsletter send with a per-tier cap (free=10/month, pro=
// 100/month). Mails land in the in-memory transport, retrievable via the
// helpers from @cosmicdrift/kumiko-bundled-features/mail-transport-inmemory.
//
// Prerequisites (see README): Postgres + Redis via `bun kumiko dev`;
// migrations via `bun kumiko migrate apply` (currently only the default
// tables — the demo has no entity projection of its own).

import { runDevApp } from "@cosmicdrift/kumiko-dev-server";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
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
