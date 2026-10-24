import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { buildServer, type JwtHelper } from "@cosmicdrift/kumiko-framework/api";
import {
  createSystemDbView,
  createTenantDb,
  type DbConnection,
} from "@cosmicdrift/kumiko-framework/db";
import {
  bridgeStub,
  createRegistry,
  createSystemUser,
  defineFeature,
  type SessionUser,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { createJobRunner, type JobRunner } from "@cosmicdrift/kumiko-framework/jobs";
import { createTestUser, TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import {
  createTestDb,
  createTestRedis,
  type TestDb,
  type TestRedis,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import type { Hono } from "hono";
import { createConfigFeature } from "../../config/feature.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { createUserFeature } from "../../user/feature.ts";
import { userEntity } from "../../user/schema/user.ts";
import { createTenantFeature } from "../feature.ts";
import { tenantMembershipsTable } from "../membership-table.ts";
import { tenantEntity } from "../schema/tenant.ts";
import { TenantHandlers, TenantQueries } from "../web/constants.ts";

// --- Track job executions ---

const jobExecutions: Array<{ name: string; tenantId: TenantId }> = [];

// --- Feature with perTenant job ---

const billingFeature = defineFeature("billing", (r) => {
  r.job("monthlyReport", { trigger: { manual: true }, perTenant: true }, async (_payload, ctx) => {
    const systemUser = ctx["systemUser"] as SessionUser;
    jobExecutions.push({ name: "billing:job:monthly-report", tenantId: systemUser.tenantId });
  });
});

// --- Setup ---

let testDb: TestDb;
let testRedis: TestRedis;
let db: DbConnection;
let app: Hono;
let jwt: JwtHelper;
let dispatcher: ReturnType<typeof buildServer>["dispatcher"];
let jobRunner: JobRunner;

const systemAdmin = TestUsers.systemAdmin;
// addMember across tenants is reserved for the framework operator identity,
// which exists in-process only (a system token over HTTP is stripped by JWT verify).
const systemContextUser = createSystemUser(systemAdmin.tenantId, ["SystemAdmin"]);
const JWT_SECRET = "multi-tenant-test-secret-minimum-32-chars!!";

beforeAll(async () => {
  testDb = await createTestDb();
  testRedis = await createTestRedis();
  db = testDb.db;

  await unsafeCreateEntityTable(db, tenantEntity);
  await unsafeCreateEntityTable(db, userEntity);
  await unsafePushTables(db, { tenantMembershipsTable, configValuesTable });

  const configFeature = createConfigFeature();
  const userFeature = createUserFeature();
  const tenantFeature = createTenantFeature();
  const registry = createRegistry([configFeature, userFeature, tenantFeature, billingFeature]);
  const resolver = createConfigResolver();

  const redisUrl = `redis://${testRedis.redis.options.host}:${testRedis.redis.options.port}/${testRedis.redis.options.db}`;

  jobRunner = createJobRunner({
    registry,
    context: { db, registry, configResolver: resolver },
    redisUrl,
    consumerLane: "worker",
    queueNamePrefix: `kumiko-multi-tenant-test-${Date.now()}`,
    getActiveTenantIds: async () => {
      const handler = registry.getQueryHandler(TenantQueries.activeTenantIds);
      if (!handler) return [];
      // Hand-built context, not routed through the dispatcher — active-tenant-ids
      // is an r.systemScope() handler, fail-closed on ctx.db, needs ctx.systemDb too.
      const systemModeDb = createTenantDb({
        db,
        tenantId: "00000000-0000-4000-8000-000000000000",
        mode: "system",
        reason: "test reads rows of several tenants",
      });
      const result = await handler.handler(
        {
          type: TenantQueries.activeTenantIds,
          payload: {},
          user: {
            id: "00000000-0000-0000-0000-000000000000",
            tenantId: "00000000-0000-4000-8000-000000000000",
            roles: ["system"],
          },
        },
        {
          db: systemModeDb,
          dbOutsideTransaction: systemModeDb,
          systemDb: createSystemDbView(systemModeDb),
          registry,
          ...bridgeStub(),
        },
      );
      return result as TenantId[];
    },
  });

  const context = { db, registry, configResolver: resolver, jobRunner };
  const server = buildServer({
    registry,
    context,
    jwtSecret: JWT_SECRET,
    auth: { membershipQuery: TenantQueries.memberships },
  });
  app = server.app;
  jwt = server.jwt;
  dispatcher = server.dispatcher;

  await jobRunner.start();
});

afterAll(async () => {
  await jobRunner.stop();
  await testDb.cleanup();
  await testRedis.cleanup();
});

// --- Helpers ---

function writeAsSystem(type: string, payload: unknown) {
  return dispatcher.write(type, payload, systemContextUser);
}

async function writeApi(user: SessionUser, type: string, payload: unknown) {
  const token = await jwt.sign(user);
  const res = await app.request("/api/write", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type, payload }),
  });
  return res.json();
}

async function queryApi(user: SessionUser, type: string, payload: unknown) {
  const token = await jwt.sign(user);
  const res = await app.request("/api/query", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type, payload }),
  });
  return res.json();
}

async function getApi(user: SessionUser, path: string) {
  const token = await jwt.sign(user);
  return app.request(`/api${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function postApi(user: SessionUser, path: string, body: unknown) {
  const token = await jwt.sign(user);
  return app.request(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

// --- Scenario 1+2: Create tenants and memberships, then switch ---

describe("multi-tenant user", () => {
  test("setup: create two tenants", async () => {
    // Explicit ids so later assertions (memberships, perTenant jobs) can
    // match against the fixed testTenantId(1/2) values the test fixtures use.
    const r1 = await writeApi(systemAdmin, TenantHandlers.create, {
      id: testTenantId(1),
      key: "acme",
      name: "ACME",
    });
    expect(r1.isSuccess).toBe(true);

    const r2 = await writeApi(systemAdmin, TenantHandlers.create, {
      id: testTenantId(2),
      key: "beta",
      name: "Beta Inc",
    });
    expect(r2.isSuccess).toBe(true);
  });

  test("add user to both tenants with different roles", async () => {
    const r1 = await writeAsSystem(TenantHandlers.addMember, {
      userId: "11111111-0000-4000-8000-000000000010",
      tenantId: testTenantId(1),
      roles: ["Admin"],
    });
    expect(r1.isSuccess).toBe(true);

    const r2 = await writeAsSystem(TenantHandlers.addMember, {
      userId: "11111111-0000-4000-8000-000000000010",
      tenantId: testTenantId(2),
      roles: ["Viewer"],
    });
    expect(r2.isSuccess).toBe(true);
  });

  test("list tenants for user shows both", async () => {
    const result = await queryApi(systemAdmin, TenantQueries.memberships, {
      userId: "11111111-0000-4000-8000-000000000010",
    });
    const memberships = result.data;
    expect(memberships.length).toBe(2);

    const tenantIds = memberships.map((m: Record<string, unknown>) => m["tenantId"]);
    expect(tenantIds).toContain(testTenantId(1));
    expect(tenantIds).toContain(testTenantId(2));

    // tenantName/tenantKey make memberships distinguishable in the UI
    // (tenant switcher); the query enriches them from the tenants table.
    const acme = memberships.find(
      (m: Record<string, unknown>) => m["tenantId"] === testTenantId(1),
    );
    expect(acme["tenantName"]).toBe("ACME");
    expect(acme["tenantKey"]).toBe("acme");
  });

  test("user has different roles per tenant", async () => {
    const result = await queryApi(systemAdmin, TenantQueries.memberships, {
      userId: "11111111-0000-4000-8000-000000000010",
    });
    const memberships = result.data;

    const acme = memberships.find(
      (m: Record<string, unknown>) => m["tenantId"] === testTenantId(1),
    );
    const beta = memberships.find(
      (m: Record<string, unknown>) => m["tenantId"] === testTenantId(2),
    );

    expect(acme["roles"]).toEqual(["Admin"]);
    expect(beta["roles"]).toEqual(["Viewer"]);
  });

  test("GET /auth/tenants returns tenant list", async () => {
    const user = createTestUser({ id: 10 });
    const res = await getApi(user, "/auth/tenants");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tenants.length).toBe(2);
    expect(body.activeTenantId).toBe(testTenantId(1));

    // name/key kommen bis in die HTTP-Response durch (Tenant-Switcher-Label).
    const names = body.tenants.map((t: Record<string, unknown>) => t["name"]);
    expect(names).toContain("ACME");
    expect(names).toContain("Beta Inc");
    const keys = body.tenants.map((t: Record<string, unknown>) => t["key"]);
    expect(keys).toContain("acme");
    expect(keys).toContain("beta");
  });

  test("POST /auth/switch-tenant issues new JWT with different tenant", async () => {
    const user = createTestUser({ id: 10 });
    const res = await postApi(user, "/auth/switch-tenant", { tenantId: testTenantId(2) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tenantId).toBe(testTenantId(2));
    expect(body.roles).toEqual(["Viewer"]);
    expect(body.token).toBeDefined();
  });

  test("switch to non-member tenant is rejected", async () => {
    const user = createTestUser({ id: 10 });
    const res = await postApi(user, "/auth/switch-tenant", { tenantId: testTenantId(999) });
    expect(res.status).toBe(403);
  });
});

// --- Scenario 4+5: perTenant jobs ---

describe("perTenant jobs", () => {
  test("perTenant job dispatches once per active tenant", async () => {
    jobExecutions.length = 0;

    await jobRunner.dispatch("billing:job:monthly-report", {});
    // This dispatches _perTenant:billing.monthlyReport which fans out
    await waitFor(() => {
      expect(jobExecutions.length).toBeGreaterThanOrEqual(2);
    });
    // A stray third fan-out run would land after the first two; wait for the queue to empty first.
    await waitFor(async () => (await jobRunner.countPendingJobs()) === 0);

    // Should have run for each active tenant (we created 2)
    expect(jobExecutions.length).toBe(2);
    const tenantIds = jobExecutions.map((e) => e.tenantId);
    expect(tenantIds).toContain(testTenantId(1));
    expect(tenantIds).toContain(testTenantId(2));
  });

  test("each sub-job has the correct tenantId in systemUser", async () => {
    for (const execution of jobExecutions) {
      // UUID strings — just ensure a non-empty tenantId landed in the systemUser.
      expect(typeof execution.tenantId).toBe("string");
      expect(execution.tenantId.length).toBeGreaterThan(0);
    }
  });
});

// --- Scenario 6: disabled tenant disappears from all auth surfaces ---
//
// tenant:write:disable silences the tenant: the memberships query filters it,
// so /auth/tenants no longer lists it (switcher), switch-tenant rejects it
// (not_a_member), and login does not select it. active-tenant-ids also excludes
// it (perTenant jobs). enable reverses all of this.
// Deliberately runs AFTER the perTenant job tests, which expect 2 active tenants.

describe("disabled tenant", () => {
  const user = createTestUser({ id: 10 });

  test("disable removes the tenant from memberships, /auth/tenants and switch-tenant", async () => {
    const r = await writeApi(systemAdmin, TenantHandlers.disable, { id: testTenantId(2) });
    expect(r.isSuccess).toBe(true);

    const result = await queryApi(systemAdmin, TenantQueries.memberships, {
      userId: "11111111-0000-4000-8000-000000000010",
    });
    const tenantIds = result.data.map((m: Record<string, unknown>) => m["tenantId"]);
    expect(tenantIds).toEqual([testTenantId(1)]);

    const res = await getApi(user, "/auth/tenants");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tenants.map((t: Record<string, unknown>) => t["tenantId"])).toEqual([
      testTenantId(1),
    ]);

    const switchRes = await postApi(user, "/auth/switch-tenant", { tenantId: testTenantId(2) });
    expect(switchRes.status).toBe(403);

    const activeIds = await queryApi(systemAdmin, TenantQueries.activeTenantIds, {});
    expect(activeIds.data).toEqual([testTenantId(1)]);
  });

  test("enable restores membership, switcher and active-tenant-ids", async () => {
    const r = await writeApi(systemAdmin, TenantHandlers.enable, { id: testTenantId(2) });
    expect(r.isSuccess).toBe(true);

    const result = await queryApi(systemAdmin, TenantQueries.memberships, {
      userId: "11111111-0000-4000-8000-000000000010",
    });
    expect(result.data.length).toBe(2);

    const switchRes = await postApi(user, "/auth/switch-tenant", { tenantId: testTenantId(2) });
    expect(switchRes.status).toBe(200);

    const activeIds = await queryApi(systemAdmin, TenantQueries.activeTenantIds, {});
    expect(activeIds.data).toContain(testTenantId(2));
  });
});

// --- Scenario 7: memberships batch-load ---
//
// The memberships query enriches all tenants in one IN-batch instead of using
// one fetchOne per membership. This test covers the two things the batch
// refactor could break: correctly keying each membership to ITS tenant (no
// collapsing or swapping when there are multiple memberships) and tolerating
// a missing tenant projection row (drift → the membership remains listed,
// avoiding a login lockout). Runs as the final block with its own user and no
// shared tenant state.

describe("memberships batch-load (#324)", () => {
  const batchUserId = "11111111-0000-4000-8000-000000000020";
  const driftTenantId = testTenantId(777);

  test("enriches every membership from one IN-batch, keeps drift rows", async () => {
    // tenants 1 (ACME) and 2 (Beta Inc) exist and are enabled;
    // driftTenant was never created, so there is no projection row.
    for (const tenantId of [testTenantId(1), testTenantId(2), driftTenantId]) {
      const r = await writeAsSystem(TenantHandlers.addMember, {
        userId: batchUserId,
        tenantId,
        roles: ["Viewer"],
      });
      expect(r.isSuccess).toBe(true);
    }

    const result = await queryApi(systemAdmin, TenantQueries.memberships, { userId: batchUserId });
    const memberships: Array<Record<string, unknown>> = result.data;
    expect(memberships.length).toBe(3);

    const acme = memberships.find((m) => m["tenantId"] === testTenantId(1));
    expect(acme?.["tenantName"]).toBe("ACME");
    expect(acme?.["tenantKey"]).toBe("acme");

    const beta = memberships.find((m) => m["tenantId"] === testTenantId(2));
    expect(beta?.["tenantName"]).toBe("Beta Inc");
    expect(beta?.["tenantKey"]).toBe("beta");

    // Drift: the membership refers to a tenant without a projection row, so
    // it remains listed without tenantName/tenantKey.
    const drift = memberships.find((m) => m["tenantId"] === driftTenantId);
    expect(drift).toBeDefined();
    expect(drift?.["tenantName"]).toBeUndefined();
    expect(drift?.["tenantKey"]).toBeUndefined();
    expect(drift?.["roles"]).toEqual(["Viewer"]);
  });
});
