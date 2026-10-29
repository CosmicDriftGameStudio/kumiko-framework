import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";

export const SEED_ADMIN_TENANT_ID = "00000000-0000-4000-8000-000000000042" as TenantId;

export const SEED_ADMIN = {
  email: "seed-admin@example.eu",
  password: "test-pw-strong-1234",
  displayName: "Seed Admin",
  memberships: [
    {
      tenantId: SEED_ADMIN_TENANT_ID,
      tenantKey: "seed-admin",
      tenantName: "Seed Admin",
      roles: ["TenantAdmin"],
    },
  ],
};

export const SEED_ADMIN_JWT_SECRET = "test-rundev-secret-32-chars-min!!!!";
