// Security integration: workspace role gates + HTTP 403 on platform queries for TenantAdmin.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  access,
  createRegistry,
  type SessionUser,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createAuditFeature } from "../../audit/feature.ts";
import { createConfigFeature } from "../../config/feature.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { ConfigQueries } from "../../config/web/constants.ts";
import { createFeatureTogglesFeature } from "../../feature-toggles/feature.ts";
import { createJobsFeature } from "../../jobs/feature.ts";
import { jobRunLogsTable, jobRunsTable } from "../../jobs/job-run-table.ts";
import { JobQueries } from "../../jobs/web/constants.ts";
import { hashPassword } from "../../shared/index.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantInvitationEntity } from "../../tenant/invitation-table.ts";
import { tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { seedTenant, seedTenantMembership } from "../../tenant/seeding.ts";
import { TenantQueries } from "../../tenant/web/constants.ts";
import { createTierEngineFeature } from "../../tier-engine/feature.ts";
import { createUserFeature } from "../../user/feature.ts";
import { userEntity } from "../../user/schema/user.ts";
import { seedUser } from "../../user/seeding.ts";
import { createAdminShellFeature } from "../feature.ts";
import {
  isOverviewQueryAllowed,
  TENANT_OVERVIEW_FORBIDDEN_QUERIES,
} from "../overview-allowlist.ts";
import {
  ADMIN_SHELL_FEATURE,
  DEFAULT_PLATFORM_WORKSPACE_ID,
  DEFAULT_TENANT_WORKSPACE_ID,
  TENANT_OVERVIEW_SCREEN_ID,
} from "../web/constants.ts";
import { ADMIN_SHELL_METRICS_FEATURES, ADMIN_SHELL_TEST_METRICS } from "./metrics-fixture.ts";

let stack: TestStack;
let TENANT_ID: TenantId;
let tenantAdminId: string;

const adminShell = createAdminShellFeature({ metrics: ADMIN_SHELL_TEST_METRICS });
const features = [
  createConfigFeature(),
  createUserFeature(),
  createTenantFeature(),
  createAuditFeature(),
  createJobsFeature(),
  ...ADMIN_SHELL_METRICS_FEATURES,
  createFeatureTogglesFeature(),
  createTierEngineFeature(),
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
  await unsafeCreateEntityTable(stack.db, tenantInvitationEntity);
  // globalFeatureStateTable is auto-provisioned by setupTestStack — no
  // manual push needed (that used to mask a missing r.storeTable()
  // registration entirely).
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
  await resetTestTables(stack.db, [tenantMembershipsTable, eventsTable]);
  TENANT_ID = crypto.randomUUID() as TenantId;
  await seedTenant(stack.db, {
    id: TENANT_ID,
    key: `t-${TENANT_ID.slice(0, 8)}`,
    name: "Shell Tenant",
  });
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
  // The tenant-overview screen dispatches only the queries baked into its
  // own dashboard panels (no client-side allowlist gate anymore) —
  // this checks the actual screen definition against the allowlist instead
  // of the allowlist against itself.
  test("tenant-overview screen panels stay inside the allowlist and off the forbidden list", () => {
    const screen = adminShell.screens[TENANT_OVERVIEW_SCREEN_ID];
    if (screen?.type !== "dashboard")
      throw new Error("expected tenant-overview to be a dashboard screen");
    const queries = screen.panels.flatMap((panel) => {
      if (panel.kind === "stat-group") return panel.stats.map((stat) => stat.query);
      return "query" in panel ? [panel.query] : [];
    });
    expect(queries.length).toBeGreaterThan(0);
    for (const query of queries) {
      expect(isOverviewQueryAllowed("tenant", query)).toBe(true);
      expect((TENANT_OVERVIEW_FORBIDDEN_QUERIES as readonly string[]).includes(query)).toBe(false);
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
