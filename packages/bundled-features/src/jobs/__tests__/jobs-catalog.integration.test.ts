// Catalog + trigger hardening for #1602 — manual-only surface.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { buildServer, type JwtHelper } from "@cosmicdrift/kumiko-framework/api";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  createRegistry,
  defineFeature,
  type SessionUser,
} from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createJobRunner, type JobRunner } from "@cosmicdrift/kumiko-framework/jobs";
import {
  createTestDb,
  createTestRedis,
  type TestDb,
  type TestRedis,
  TestUsers,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import type { Hono } from "hono";
import { z } from "zod";
import { JobErrors, JobHandlers, JobQueries } from "../constants";
import { createJobsFeature } from "../feature";
import { createJobRunLogger } from "../job-run-logger";
import { jobRunLogsTable, jobRunsTable } from "../job-run-table";

let testDb: TestDb;
let testRedis: TestRedis;
let db: DbConnection;
let app: Hono;
let jwt: JwtHelper;
let jobRunner: JobRunner;

const systemAdmin = TestUsers.systemAdmin;
const JWT_SECRET = "test-jwt-secret-for-jobs-catalog-32chars!!";

const appFeature = defineFeature("catalog-app", (r) => {
  r.job(
    "manualEcho",
    { trigger: { manual: true }, schema: z.object({ entity: z.string().min(1) }) },
    async () => {},
  );
  r.job("cronOnly", { trigger: { cron: "0 * * * *" } }, async () => {});
});

beforeAll(async () => {
  testDb = await createTestDb();
  testRedis = await createTestRedis();
  db = testDb.db;

  const registry = createRegistry([appFeature, createJobsFeature()]);
  await unsafePushTables(db, { jobRunsTable, jobRunLogsTable });
  await createEventsTable(db);

  const redisUrl = `redis://${testRedis.redis.options.host}:${testRedis.redis.options.port}/${testRedis.redis.options.db}`;
  const logger = createJobRunLogger({ db, registry });
  jobRunner = createJobRunner({
    registry,
    context: { db },
    redisUrl,
    consumerLane: "worker",
    queueNamePrefix: `kumiko-jobs-catalog-test-${Date.now()}`,
    ...logger,
  });
  const context = { db, registry, jobRunner };
  const server = buildServer({ registry, context, jwtSecret: JWT_SECRET });
  app = server.app;
  jwt = server.jwt;

  await jobRunner.start();
});

afterAll(async () => {
  await jobRunner.stop();
  await testDb.cleanup();
  await testRedis.cleanup();
});

async function req(
  method: string,
  path: string,
  user: SessionUser,
  body?: unknown,
): Promise<Response> {
  const token = await jwt.sign(user);
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  };
  if (body) init.body = JSON.stringify(body);
  return app.request(path, init);
}

async function write(user: SessionUser, type: string, payload: unknown) {
  const res = await req("POST", "/api/write", user, { type, payload });
  return res.json();
}

async function query(user: SessionUser, type: string, payload: unknown) {
  const res = await req("POST", "/api/query", user, { type, payload });
  const body = await res.json();
  if (res.status !== 200) {
    throw new Error(`query ${type} → ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

describe("jobs:query:catalog", () => {
  test("lists only manual jobs including framework builtins", async () => {
    const result = await query(systemAdmin, JobQueries.catalog, {});
    type CatalogRow = {
      readonly jobName: string;
      readonly perTenant: boolean;
      readonly payloadSchema: Record<string, unknown> | null;
    };
    const rows = (result.data as { rows: readonly CatalogRow[] }).rows;
    const names = rows.map((r) => r.jobName);
    expect(names).toContain("catalog-app:job:manual-echo");
    expect(names).toContain("jobs:job:reindex-entity");
    expect(names).toContain("jobs:job:projection-rebuild");
    expect(names).not.toContain("catalog-app:job:cron-only");

    const echo = rows.find((r) => r.jobName === "catalog-app:job:manual-echo");
    expect(echo).toBeDefined();
    expect(echo?.payloadSchema).not.toBeNull();

    const reindex = rows.find((r) => r.jobName === "jobs:job:reindex-entity");
    expect(reindex?.perTenant).toBe(true);
  });
});

describe("jobs:write:trigger hardening", () => {
  test("rejects cron-only jobs", async () => {
    const result = await write(systemAdmin, JobHandlers.trigger, {
      jobName: "catalog-app:job:cron-only",
    });
    expect(result.isSuccess).toBe(false);
    expect(result.error?.code).toBe("unprocessable");
    expect(result.error?.details).toMatchObject({ reason: JobErrors.notManual });
  });

  test("rejects invalid payload against job schema", async () => {
    const result = await write(systemAdmin, JobHandlers.trigger, {
      jobName: "catalog-app:job:manual-echo",
      payload: {},
    });
    expect(result.isSuccess).toBe(false);
    expect(result.error?.code).toBe("validation_error");
  });

  test("accepts valid schema payload", async () => {
    const result = await write(systemAdmin, JobHandlers.trigger, {
      jobName: "catalog-app:job:manual-echo",
      payload: { entity: "credit" },
    });
    expect(result.isSuccess).toBe(true);
  });
});
