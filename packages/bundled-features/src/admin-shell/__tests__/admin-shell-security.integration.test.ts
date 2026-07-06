// Security integration: workspace role gates + HTTP 403 on platform queries for TenantAdmin.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  access,
  createRegistry,
  type SessionUser,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { createAuditFeature } from "../../audit/feature";
import { ConfigQueries } from "../../config/constants";
import { createConfigFeature } from "../../config/feature";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createJobsFeature } from "../../jobs/feature";
import { JobQueries } from "../../jobs/constants";
import { jobRunLogsTable, jobRunsTable } from "../../jobs/job-run-table";
import { hashPassword } from "../../auth-email-password/password-hashing";
import { createUserFeature } from "../../user/feature";
import { userEntity } from "../../user/schema/user";
import { seedUser } from "../../user/seeding";
import { TenantQueries } from "../../tenant/constants";
import { createTenantFeature } from "../../tenant/feature";
import { tenantMembershipsTable } from "../../tenant/membership-table";
import { seedTenant, seedTenantMembership } from "../../tenant/seeding";
import { tenantEntity } from "../../tenant/schema/tenant";
import { tierEngineFeature } from "../../tier-engine/feature";
import {
  ADMIN_SHELL_FEATURE,
  DEFAULT_PLATFORM_WORKSPACE_ID,
  DEFAULT_TENANT_WORKSPACE_ID,
} from "../constants";
import {
  TENANT_OVERVIEW_ALLOWED_QUERIES,
  TENANT_OVERVIEW_FORBIDDEN_QUERIES,
} from "../overview-allowlist";
import { createAdminShellFeature } from "../feature";

let stack: TestStack;
let TENANT_ID: TenantId;
let tenantAdminId: string;

const adminShell = createAdminShellFeature();
const features = [
  createConfigFeature(),
  createUserFeature(),
  createTenantFeature(),
  createAuditFeature(),
  createJobsFeature(),
  tierEngineFeature,
  adminShell,
];

function tenantAdmin(): SessionUser {
  return { id: tenantAdminId, tenantId: TENANT_ID, roles: ["TenantAdmin"] };
}

function regularUser(): SessionUser {
  return { id: tenantAdminId, tenantId: TENANT_ID, roles: ["User"] };
}

beforeAll(async () => {
  stack = await setupTestStack({
    features,
    extraContext: () => ({ configResolver: createConfigResolver() }),
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, {
    configValuesTable,
    tenantMembershipsTable,
    jobRunsTable,
    jobRunLogsTable,
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantMembershipsTable.tableName}"`);
  TENANT_ID = crypto.randomUUID() as TenantId;
  await seedTenant(stack.db, { id: TENANT_ID, key: `t-${TENANT_ID.slice(0, 8)}`, name: "Shell Tenant" });
  ({ id: tenantAdminId } = await seedUser(stack.db, {
    email: `ta-${TENANT_ID.slice(0, 8)}@example.com`,
    displayName: "Tenant Admin",
    passwordHash: await hashPassword("pw-shell-ta-1234"),
    emailVerified: true,
  }));
  await seedTenantMembership(stack.db, {
    userId: tenantAdminId,
    tenantId: TENANT_ID,
    roles: ["TenantAdmin"],
  });
});

describe("workspace access matrix", () => {
  test("tenant workspace is access.admin; platform is SystemAdmin-only", () => {
    const registry = createRegistry(features);
    const tenantWs = registry.getWorkspace(
      `${ADMIN_SHELL_FEATURE}:workspace:${DEFAULT_TENANT_WORKSPACE_ID}`,
    );
    const platformWs = registry.getWorkspace(
      `${ADMIN_SHELL_FEATURE}:workspace:${DEFAULT_PLATFORM_WORKSPACE_ID}`,
    );
    expect(tenantWs?.access).toEqual({ roles: access.admin });
    expect(platformWs?.access).toEqual({ roles: access.systemAdmin });
  });
});

describe("TenantAdmin HTTP surface", () => {
  test("can list members and audit for own tenant", async () => {
    const members = await stack.http.queryOk<readonly unknown[]>(
      TenantQueries.members,
      {},
      tenantAdmin(),
    );
    expect(members.some((m) => (m as { userId: string }).userId === tenantAdminId)).toBe(true);
    const audit = await stack.http.queryOk<{ rows: readonly unknown[] }>(
      "audit:query:list",
      {},
      tenantAdmin(),
    );
    expect(Array.isArray(audit.rows)).toBe(true);
  });

  test("403 on platform jobs:list and tenant:list", async () => {
    expect((await stack.http.query(JobQueries.list, {}, tenantAdmin())).status).toBe(403);
    expect((await stack.http.query(TenantQueries.list, {}, tenantAdmin())).status).toBe(403);
  });
});

describe("regular User denied tenant-admin nav data", () => {
  test("403 on members and audit", async () => {
    expect((await stack.http.query(TenantQueries.members, {}, regularUser())).status).toBe(403);
    expect((await stack.http.query("audit:query:list", {}, regularUser())).status).toBe(403);
  });
});

describe("SystemAdmin platform queries", () => {
  test("can list tenants and job runs", async () => {
    const tenants = await stack.http.queryOk<{ rows: readonly unknown[] }>(
      TenantQueries.list,
      {},
      TestUsers.systemAdmin,
    );
    expect(tenants.rows.length).toBeGreaterThanOrEqual(1);
    const jobs = await stack.http.queryOk<{ rows: readonly unknown[] }>(
      JobQueries.list,
      {},
      TestUsers.systemAdmin,
    );
    expect(Array.isArray(jobs.rows)).toBe(true);
  });
});

describe("tenant overview query allowlist", () => {
  test("static allowlist excludes every forbidden platform query", () => {
    for (const qn of TENANT_OVERVIEW_FORBIDDEN_QUERIES) {
      expect(TENANT_OVERVIEW_ALLOWED_QUERIES).not.toContain(qn);
    }
  });

  test("TenantAdmin can run tenant-overview allowed queries", async () => {
    await stack.http.queryOk(TenantQueries.invitations, {}, tenantAdmin());
    await stack.http.queryOk(TenantQueries.members, {}, tenantAdmin());
    const readiness = await stack.http.queryOk<{ missing: readonly unknown[] }>(
      ConfigQueries.readiness,
      {},
      tenantAdmin(),
    );
    expect(Array.isArray(readiness.missing)).toBe(true);
  });

  test("TenantAdmin gets 403 on every forbidden overview query", async () => {
    for (const qn of TENANT_OVERVIEW_FORBIDDEN_QUERIES) {
      expect((await stack.http.query(qn, {}, tenantAdmin())).status).toBe(403);
    }
  });
});
