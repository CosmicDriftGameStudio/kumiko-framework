// Seed-Helper für den Dev-Server. `onAfterSetup` ruft seedAdminUser()
// das den Admin + einen Dev-Tenant + Membership idempotent anlegt. Die
// eigentliche Helper-Logik (executor-direkt, lookup-first, Event-
// Sourcing erhalten) lebt in @kumiko/bundled-features/auth-email-
// password/seeding.

import { seedAdmin } from "@kumiko/bundled-features/auth-email-password/seeding";
import type { TenantId } from "@kumiko/framework/engine";
import type { TestStack } from "@kumiko/framework/testing";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./auth-constants";

// Ein Dev-Tenant reicht — die Workspaces filtern nach `roles` (nicht
// nach Tenant), und ein einzelner Tenant macht den Login-Flow im Sample
// simpler. Wer Tenant-Switching demoen will, schaut in den
// ui-walkthrough-Sample.
export const DEV_TENANT_ID = "00000000-0000-4000-8000-000000000010" as TenantId;

export async function seedAdminUser(stack: TestStack): Promise<void> {
  await seedAdmin(stack.db, {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    displayName: "Admin",
    // Admin-Rolle gibt Zugriff auf alle drei Workspaces (admin/dispatch/
    // driver). Realwelt-Apps würden weitere Rollen + User definieren —
    // das Sample beweist die Verdrahtung, nicht die Rollen-Vielfalt.
    memberships: [
      { tenantId: DEV_TENANT_ID, tenantKey: "dev", tenantName: "Dev Tenant", roles: ["Admin"] },
    ],
  });
}
