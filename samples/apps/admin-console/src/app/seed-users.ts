// @runtime dev
// Extra users for role-gated workspace demos — separate from sysadmin seed.

import type { SeedFn } from "@cosmicdrift/kumiko-dev-server";
import { hashPassword } from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
import { seedUser } from "@cosmicdrift/kumiko-bundled-features/user/seeding";
import { seedTenantMembership } from "@cosmicdrift/kumiko-bundled-features/tenant/seeding";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  DEV_TENANT_ID,
  REGULAR_USER_EMAIL,
  REGULAR_USER_PASSWORD,
  TENANT_ADMIN_EMAIL,
  TENANT_ADMIN_PASSWORD,
} from "./auth-constants";

export const seedRoleUsers: SeedFn = async (stack) => {
  const tenantId = DEV_TENANT_ID as TenantId;
  const tenantAdmin = await seedUser(stack.db, {
    email: TENANT_ADMIN_EMAIL,
    displayName: "Tenant Admin",
    passwordHash: await hashPassword(TENANT_ADMIN_PASSWORD),
    emailVerified: true,
  });
  await seedTenantMembership(stack.db, {
    userId: tenantAdmin.id,
    tenantId,
    roles: ["TenantAdmin"],
  });

  const regular = await seedUser(stack.db, {
    email: REGULAR_USER_EMAIL,
    displayName: "Regular User",
    passwordHash: await hashPassword(REGULAR_USER_PASSWORD),
    emailVerified: true,
  });
  await seedTenantMembership(stack.db, {
    userId: regular.id,
    tenantId,
    roles: ["User"],
  });
};
