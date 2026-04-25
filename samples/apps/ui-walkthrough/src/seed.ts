// Seed-Helper für den Dev-Server. `onAfterSetup` ruft seedAdminUser()
// das den Admin + zwei Dev-Tenants + Memberships idempotent anlegt.
// Die Helper-Logik (executor-direkt, lookup-first, Event-Sourcing
// erhalten) lebt in @kumiko/bundled-features/auth-email-password/seeding
// — der Sample beschreibt nur noch WAS gesäht wird, nicht WIE.

import { seedAdmin } from "@kumiko/bundled-features/auth-email-password/seeding";
import type { TenantId } from "@kumiko/framework/engine";
import type { TestStack } from "@kumiko/framework/testing";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./auth-constants";

export { ADMIN_EMAIL, ADMIN_PASSWORD };

// Zwei feste Tenants — Admin ist in beiden Mitglied damit der
// TenantSwitcher im Sample sichtbar ist (rendert nur bei >1 Tenant).
// Unterschiedliche Rollen pro Tenant beweisen tenant-isolierte
// Memberships.
export const DEV_TENANT_ID = "00000000-0000-4000-8000-000000000001" as TenantId;
export const BETA_TENANT_ID = "00000000-0000-4000-8000-000000000002" as TenantId;

export async function seedAdminUser(stack: TestStack): Promise<void> {
  await seedAdmin(stack.db, {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    displayName: "Admin",
    memberships: [
      { tenantId: DEV_TENANT_ID, tenantKey: "dev", tenantName: "Dev Tenant", roles: ["Admin"] },
      { tenantId: BETA_TENANT_ID, tenantKey: "beta", tenantName: "Beta Tenant", roles: ["User"] },
    ],
  });
}
