// @runtime dev
//
// Dev server for the workspaces sample. Auth mode active: the client
// must log in via the login screen. WorkspaceShell then filters
// by `user.roles` from the session — admin sees all three, other
// roles only theirs.
//
// runDevApp mixes in the standard features (config/user/tenant/auth)
// automatically when `auth` is set and calls seedAdmin in
// onAfterSetup. The client loads the schema itself via the
// authenticated GET /api/schema, no hand-written
// clientSchema mirror.

import { runDevApp } from "@cosmicdrift/kumiko-dev-server";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { demoFeature } from "../features/demo";
import { driverFeature } from "../features/demo-driver";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./auth-constants";

// One dev tenant is enough — the workspaces filter by `roles` (not
// by tenant). To demo tenant switching, look at the
// ui-walkthrough sample.
const DEV_TENANT_ID = "00000000-0000-4000-8000-000000000010" as TenantId;

import { localeDe } from "@cosmicdrift/kumiko-locale-de";

await runDevApp({
  features: [localeDe(), demoFeature, driverFeature],
  // PORT env var override for Playwright e2e runs (config points to 4175);
  // otherwise local default 4174.
  port: Number.parseInt(process.env["PORT"] ?? "4174", 10),
  clientEntry: "./src/app/client.tsx",
  htmlPath: "./public/index.html",
  watchDirs: ["./src", "../../../packages/*/src"],
  auth: {
    admin: {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      displayName: "Admin",
      // The admin role grants access to all three workspaces (admin/dispatch/
      // driver). Real-world apps would define further roles + users.
      memberships: [
        { tenantId: DEV_TENANT_ID, tenantKey: "dev", tenantName: "Dev Tenant", roles: ["Admin"] },
      ],
    },
  },
});
