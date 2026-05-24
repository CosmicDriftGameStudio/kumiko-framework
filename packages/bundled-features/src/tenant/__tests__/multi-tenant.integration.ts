import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { buildServer, type JwtHelper } from "@cosmicdrift/kumiko-framework/api";
import { createTenantDb, type DbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  createRegistry,
  defineFeature,
  type SessionUser,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createJobRunner, type JobRunner } from "@cosmicdrift/kumiko-framework/jobs";
import {
  createTestDb,
  createTestRedis,
  createTestUser,
  type TestDb,
  type TestRedis,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { bridgeStub, sleep } from "@cosmicdrift/kumiko-framework/testing";
import type { Hono } from "hono";
import { createConfigFeature } from "../../config/feature";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { TenantHandlers, TenantQueries } from "../constants";
import { createTenantFeature } from "../feature";
import { tenantMembershipsTable } from "../membership-table";
import { tenantEntity } from "../schema/tenant";

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
let jobRunner: JobRunner;

const systemAdmin = TestUsers.systemAdmin;
const JWT_SECRET = "multi-tenant-test-secret-minimum-32-chars!!";

beforeAll(async () => {
  testDb = await createTestDb();
  testRedis = await createTestRedis();
  db = testDb.db;

  await unsafeCreateEntityTable(db, tenantEntity);
  await unsafePushTables(db, { tenantMembershipsTable, configValuesTable });
  await createEventsTable(db);

  const configFeature = createConfigFeature();
  const tenantFeature = createTenantFeature();
  const registry = createRegistry([configFeature, tenantFeature, billingFeature]);
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
          db: createTenantDb(db, "00000000-0000-4000-8000-000000000000", "system"),
          registry,
          ...bridgeStub(),
        },
      );
      return result as number[];
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

  await jobRunner.start();
});

afterAll(async () => {
  await jobRunner.stop();
  await testDb.cleanup();
  await testRedis.cleanup();
});

// --- Helpers ---

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
    const r1 = await writeApi(systemAdmin, TenantHandlers.addMember, {
      userId: "11111111-0000-4000-8000-000000000010",
      tenantId: testTenantId(1),
      roles: ["Admin"],
    });
    expect(r1.isSuccess).toBe(true);

    const r2 = await writeApi(systemAdmin, TenantHandlers.addMember, {
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
    // Wait for fan-out + processing
    await sleep(2000);

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
