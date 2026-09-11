import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { billingFoundationFeature } from "../../billing-foundation";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles";
import { createConfigFeature } from "../../config";
import { createTenantFeature } from "../../tenant/feature";
import { tenantEntity } from "../../tenant/schema/tenant";
import { seedTenant } from "../../tenant/seeding";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle";
import { TierEngineHandlers, tierAssignmentEntity, tierEngineFeature } from "../../tier-engine";
import { CapOverviewQueries } from "../constants";
import { createCapOverviewFeature } from "../feature";
import type { CapSpec } from "../types";

// Two tenants with distinct usage numbers — proves reads are scoped by
// tenantId, not "whichever row comes back first" or a summed total.
const TENANT_A = testTenantId(9001);
const TENANT_B = testTenantId(9002);
// Distinct tier from A/B — lets sort=tier be told apart from the sort=name default.
const TENANT_C = testTenantId(9003);
const USAGE_BY_TENANT: Readonly<Record<string, number>> = {
  [TENANT_A]: 3,
  [TENANT_B]: 7,
};

const testCap: CapSpec = {
  id: "widgets",
  label: "test.cap.widgets",
  limit: () => 10,
  usage: async (_db, tenantId) => USAGE_BY_TENANT[tenantId] ?? 0,
};

// Never wired up for any tenant — proves the "not measured" state renders
// as null, not 0, all the way through the real query handler.
const unmeasuredCap: CapSpec = {
  id: "unmeasured",
  label: "test.cap.unmeasured",
  limit: () => 10,
  usage: async () => null,
};

let stack: TestStack;
let db: DbConnection;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      billingFoundationFeature,
      tierEngineFeature,
      createCapOverviewFeature({ caps: [testCap, unmeasuredCap] }),
    ],
  });
  db = stack.db;
  await createEventsTable(db);
  await unsafeCreateEntityTable(db, tenantEntity);
  await unsafeCreateEntityTable(db, tierAssignmentEntity);
  await unsafeCreateEntityTable(db, tenantComplianceProfileEntity);
  configurePiiSubjectKms(new InMemoryKmsAdapter());

  await seedTenant(db, { id: TENANT_A, key: `cap-overview-a-${TENANT_A}`, name: "Tenant A" });
  await seedTenant(db, { id: TENANT_B, key: `cap-overview-b-${TENANT_B}`, name: "Tenant B" });
  await seedTenant(db, { id: TENANT_C, key: `cap-overview-c-${TENANT_C}`, name: "Tenant C" });

  const ownerA = createTestUser({
    id: 90011,
    tenantId: TENANT_A,
    roles: ["TenantAdmin", "SystemAdmin"],
  });
  const ownerB = createTestUser({
    id: 90021,
    tenantId: TENANT_B,
    roles: ["TenantAdmin", "SystemAdmin"],
  });
  const ownerC = createTestUser({
    id: 90031,
    tenantId: TENANT_C,
    roles: ["TenantAdmin", "SystemAdmin"],
  });
  await stack.http.writeOk(TierEngineHandlers.create, { tier: "pro" }, ownerA);
  await stack.http.writeOk(TierEngineHandlers.create, { tier: "pro" }, ownerB);
  await stack.http.writeOk(TierEngineHandlers.create, { tier: "starter" }, ownerC);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("cap-overview tenant isolation", () => {
  test("TenantAdmin(A) cannot read tenant B's usage via override", async () => {
    const tenantAdminA = createTestUser({ id: 90012, tenantId: TENANT_A, roles: ["TenantAdmin"] });
    const res = await stack.http.query(
      CapOverviewQueries.capsUsage,
      { tenantId: TENANT_B },
      tenantAdminA,
    );
    expect(res.status).toBe(403);
  });

  test("TenantAdmin(A) cannot list all tenants", async () => {
    const tenantAdminA = createTestUser({ id: 90013, tenantId: TENANT_A, roles: ["TenantAdmin"] });
    const res = await stack.http.query(CapOverviewQueries.tenantCapsList, {}, tenantAdminA);
    expect(res.status).toBe(403);
  });

  test("TenantAdmin(A) without override sees exactly A's own numbers, not a sum", async () => {
    const tenantAdminA = createTestUser({ id: 90014, tenantId: TENANT_A, roles: ["TenantAdmin"] });
    const result = await stack.http.queryOk<{
      rows: readonly { id: string; used: number | null; percent: number | null }[];
    }>(CapOverviewQueries.capsUsage, {}, tenantAdminA);
    expect(result.rows).toHaveLength(2);
    const widgetsRow = result.rows.find((row) => row.id === testCap.id);
    expect(widgetsRow?.used).toBe(USAGE_BY_TENANT[TENANT_A]);

    const unmeasuredRow = result.rows.find((row) => row.id === unmeasuredCap.id);
    expect(unmeasuredRow?.used).toBeNull();
    expect(unmeasuredRow?.percent).toBeNull();
  });

  test("SystemAdmin can read tenant B's usage via override", async () => {
    const sysAdmin = createTestUser({ id: 90015, tenantId: TENANT_A, roles: ["SystemAdmin"] });
    const result = await stack.http.queryOk<{
      rows: readonly { id: string; used: number | null }[];
    }>(CapOverviewQueries.capsUsage, { tenantId: TENANT_B }, sysAdmin);
    const widgetsRow = result.rows.find((row) => row.id === testCap.id);
    expect(widgetsRow?.used).toBe(USAGE_BY_TENANT[TENANT_B]);
  });

  test("SystemAdmin sees both tenants on the list, each with its own numbers", async () => {
    const sysAdmin = createTestUser({ id: 90016, tenantId: TENANT_A, roles: ["SystemAdmin"] });
    const result = await stack.http.queryOk<{
      rows: readonly Record<string, unknown>[];
    }>(CapOverviewQueries.tenantCapsList, {}, sysAdmin);

    const byTenant = new Map(result.rows.map((row) => [row["tenantId"] as string, row]));
    const capField = `cap_${testCap.id}`;
    expect((byTenant.get(TENANT_A)?.[capField] as { used: number } | undefined)?.used).toBe(
      USAGE_BY_TENANT[TENANT_A],
    );
    expect((byTenant.get(TENANT_B)?.[capField] as { used: number } | undefined)?.used).toBe(
      USAGE_BY_TENANT[TENANT_B],
    );
  });
});

describe("cap-overview my-caps for regular tenant members", () => {
  test("a regular User(A) reads A's own usage, not a 403", async () => {
    const memberA = createTestUser({ id: 90041, tenantId: TENANT_A, roles: ["User"] });
    const result = await stack.http.queryOk<{
      rows: readonly { id: string; used: number | null }[];
    }>(CapOverviewQueries.capsUsage, {}, memberA);
    const widgetsRow = result.rows.find((row) => row.id === testCap.id);
    expect(widgetsRow?.used).toBe(USAGE_BY_TENANT[TENANT_A]);
  });

  test("an Editor(B) reads B's own usage, not A's", async () => {
    const editorB = createTestUser({ id: 90042, tenantId: TENANT_B, roles: ["Editor"] });
    const result = await stack.http.queryOk<{
      rows: readonly { id: string; used: number | null }[];
    }>(CapOverviewQueries.capsUsage, {}, editorB);
    const widgetsRow = result.rows.find((row) => row.id === testCap.id);
    expect(widgetsRow?.used).toBe(USAGE_BY_TENANT[TENANT_B]);
    expect(widgetsRow?.used).not.toBe(USAGE_BY_TENANT[TENANT_A]);
  });

  test("a regular User(A) cannot read tenant B's usage via override", async () => {
    const memberA = createTestUser({ id: 90043, tenantId: TENANT_A, roles: ["User"] });
    const res = await stack.http.query(
      CapOverviewQueries.capsUsage,
      { tenantId: TENANT_B },
      memberA,
    );
    expect(res.status).toBe(403);
  });

  test("a regular User(A) cannot list all tenants", async () => {
    const memberA = createTestUser({ id: 90044, tenantId: TENANT_A, roles: ["User"] });
    const res = await stack.http.query(CapOverviewQueries.tenantCapsList, {}, memberA);
    expect(res.status).toBe(403);
  });

  test("a regular User(A) cannot enumerate tenant names via the platform picker", async () => {
    const memberA = createTestUser({ id: 90045, tenantId: TENANT_A, roles: ["User"] });
    const res = await stack.http.query(CapOverviewQueries.tenantOptions, {}, memberA);
    expect(res.status).toBe(403);
  });

  test("an unranked app role still cannot reach my-caps", async () => {
    const viewerA = createTestUser({ id: 90046, tenantId: TENANT_A, roles: ["Viewer"] });
    const res = await stack.http.query(CapOverviewQueries.capsUsage, {}, viewerA);
    expect(res.status).toBe(403);
  });
});

describe("cap-overview tier filter operators", () => {
  test("op:ne excludes tenants matching the value, not just those matching it", async () => {
    const sysAdmin = createTestUser({ id: 90017, tenantId: TENANT_A, roles: ["SystemAdmin"] });
    const result = await stack.http.queryOk<{ rows: readonly { tenantId: string }[] }>(
      CapOverviewQueries.tenantCapsList,
      { filters: [{ field: "tier", op: "ne", value: "pro" }] },
      sysAdmin,
    );
    const tenantIds = result.rows.map((row) => row.tenantId);
    expect(tenantIds).not.toContain(TENANT_A);
    expect(tenantIds).not.toContain(TENANT_B);
    expect(tenantIds).toContain(TENANT_C);
  });

  test("op:lt on tier is rejected, not silently treated as no filter", async () => {
    const sysAdmin = createTestUser({ id: 90018, tenantId: TENANT_A, roles: ["SystemAdmin"] });
    const res = await stack.http.query(
      CapOverviewQueries.tenantCapsList,
      { filters: [{ field: "tier", op: "lt", value: "pro" }] },
      sysAdmin,
    );
    expect(res.status).toBe(400);
  });
});

describe("cap-overview list sort", () => {
  test("sort:tier actually reorders the list, not just sortDirection", async () => {
    const sysAdmin = createTestUser({ id: 90019, tenantId: TENANT_A, roles: ["SystemAdmin"] });
    const result = await stack.http.queryOk<{
      rows: readonly { tenantId: string; tier: string }[];
    }>(CapOverviewQueries.tenantCapsList, { sort: "tier", sortDirection: "asc" }, sysAdmin);
    const tierOrder = result.rows.map((row) => row.tier);
    const sortedAscending = [...tierOrder].sort((a, b) => a.localeCompare(b));
    expect(tierOrder).toEqual(sortedAscending);
    expect(tierOrder).toContain("starter");
  });

  test("an unsupported sort field is rejected, not silently ignored", async () => {
    const sysAdmin = createTestUser({ id: 90020, tenantId: TENANT_A, roles: ["SystemAdmin"] });
    const res = await stack.http.query(
      CapOverviewQueries.tenantCapsList,
      { sort: "usage" },
      sysAdmin,
    );
    expect(res.status).toBe(400);
  });
});
