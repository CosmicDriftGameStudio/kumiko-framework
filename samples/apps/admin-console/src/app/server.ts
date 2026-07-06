// @runtime dev
import { runDevApp } from "@cosmicdrift/kumiko-dev-server";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { APP_FEATURES } from "../run-config";
import { DEV_TENANT_ID, SYSADMIN_EMAIL, SYSADMIN_PASSWORD } from "./auth-constants";
import { seedRoleUsers } from "./seed-users";

await runDevApp({
  features: APP_FEATURES,
  port: Number.parseInt(process.env["PORT"] ?? "4177", 10),
  clientEntry: "./src/app/client.tsx",
  htmlPath: "./public/index.html",
  watchDirs: ["./src", "../../../packages/*/src"],
  seeds: [seedRoleUsers],
  auth: {
    admin: {
      email: SYSADMIN_EMAIL,
      password: SYSADMIN_PASSWORD,
      displayName: "Platform Operator",
      globalRoles: ["SystemAdmin"],
      memberships: [
        {
          tenantId: DEV_TENANT_ID as TenantId,
          tenantKey: "demo",
          tenantName: "Admin Console Demo",
          roles: ["Admin"],
        },
      ],
    },
  },
});
