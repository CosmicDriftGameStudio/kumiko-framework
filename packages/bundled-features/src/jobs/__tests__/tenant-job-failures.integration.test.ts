// Tenant-visible job failures (fw#3079) end to end: a write triggers a job,
// the job fails, and the triggering tenant reads the failure back through
// `jobs:query:failures` — over real HTTP, a real BullMQ worker and a real
// Postgres, with the real createJobRunLogger callbacks wired in.
//
// Not setupTestStack: that helper builds a JobRunner but wires none of the
// bundled run-logger callbacks (test-stack.ts), which are the write path
// under test here. Same buildServer + createJobRunner + createJobRunLogger
// harness the neighbouring jobs integration tests use.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { buildServer, type JwtHelper } from "@cosmicdrift/kumiko-framework/api";
import { insertOne, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  createRegistry,
  defineFeature,
  defineWriteHandler,
  type SessionUser,
} from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError } from "@cosmicdrift/kumiko-framework/errors";
import { createJobRunner, type JobRunner } from "@cosmicdrift/kumiko-framework/jobs";
import {
  createTestDb,
  createTestRedis,
  createTestUser,
  type TestDb,
  type TestRedis,
  testTenantId,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { sleep } from "@cosmicdrift/kumiko-framework/testing";
import type { Hono } from "hono";
import { z } from "zod";
import { JobQueries } from "../constants";
import { createJobsFeature } from "../feature";
import { createJobRunLogger } from "../job-run-logger";
import { jobRunLogsTable, jobRunsTable } from "../job-run-table";
import { tenantJobFailuresTable } from "../tenant-job-failure-table";

const JWT_SECRET = "tenant-job-failures-integration-secret-key-0123456789";
const DECLARED_KEY = "app:errors.generationFailed";
const BUDGET_KEY = "app:errors.budgetExceeded";
// A provider message that must never reach the tenant.
const PROVIDER_MESSAGE = "openai 429: prompt 'Herr Schmidt, Kennzeichen B-XY-123' rejected";

const tenantA = testTenantId(1);
const tenantB = testTenantId(2);
const userA = createTestUser({ id: 1, tenantId: tenantA, roles: ["Admin"] });
const userB = createTestUser({ id: 2, tenantId: tenantB, roles: ["Admin"] });
const systemAdmin = createTestUser({ id: 3, tenantId: tenantA, roles: ["SystemAdmin"] });

const generateWrite = defineWriteHandler({
  name: "generate",
  description: "Test-only: starts the text generation for one campaign.",
  schema: z.object({ campaignId: z.string(), mode: z.enum(["fail", "budget", "succeed"]) }),
  access: { roles: ["Admin"] },
  handler: async (event) => ({ isSuccess: true as const, data: { ...event.payload } }),
});

const retryWrite = defineWriteHandler({
  name: "startFlaky",
  description: "Test-only: starts a job that fails on every attempt.",
  schema: z.object({}),
  access: { roles: ["Admin"] },
  handler: async () => ({ isSuccess: true as const, data: {} }),
});

const appFeature = defineFeature("app", (r) => {
  r.writeHandler(generateWrite);
  r.writeHandler(retryWrite);

  r.job(
    "generateTexts",
    {
      trigger: { on: "app:write:generate" },
      tenantVisibleFailure: { messageKey: DECLARED_KEY, subjectFields: ["campaignId"] },
    },
    async (payload) => {
      if (payload["mode"] === "budget") {
        throw new UnprocessableError("budget_exceeded", { i18nKey: BUDGET_KEY });
      }
      if (payload["mode"] === "fail") throw new Error(PROVIDER_MESSAGE);
    },
  );

  // retries: 1 — two attempts, both failing. Only the last one may record.
  r.job(
    "flaky",
    {
      trigger: { on: "app:write:start-flaky" },
      retries: 1,
      tenantVisibleFailure: { messageKey: DECLARED_KEY },
    },
    async () => {
      throw new Error(PROVIDER_MESSAGE);
    },
  );
});

let testDb: TestDb;
let testRedis: TestRedis;
let db: DbConnection;
let app: Hono;
let jwt: JwtHelper;
let jobRunner: JobRunner;

beforeAll(async () => {
  testDb = await createTestDb();
  testRedis = await createTestRedis();
  db = testDb.db;

  const registry = createRegistry([appFeature, createJobsFeature()]);
  await unsafePushTables(db, { jobRunsTable, jobRunLogsTable, tenantJobFailuresTable });

  const redisUrl = `redis://${testRedis.redis.options.host}:${testRedis.redis.options.port}/${testRedis.redis.options.db}`;
  jobRunner = createJobRunner({
    registry,
    context: { db },
    redisUrl,
    consumerLane: "worker",
    queueNamePrefix: `kumiko-tenant-job-failures-${Date.now()}`,
    ...createJobRunLogger({ db, registry }),
  });

  const server = buildServer({
    registry,
    context: { db, registry, jobRunner },
    jwtSecret: JWT_SECRET,
    // Event-triggered jobs enqueue from dispatch-write's afterCommit hooks,
    // which read the runner off the dispatcher — not off the AppContext.
    dispatcherOptions: { jobRunner },
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

async function post(path: string, user: SessionUser, body: unknown): Promise<Response> {
  const token = await jwt.sign(user);
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

type FailureRow = {
  readonly jobName: string;
  readonly subject: Record<string, unknown> | null;
  readonly messageKey: string;
};

async function generate(
  user: SessionUser,
  campaignId: string,
  mode: "fail" | "budget" | "succeed",
): Promise<void> {
  const res = await post("/api/write", user, {
    type: "app:write:generate",
    payload: { campaignId, mode },
  });
  expect((await res.json()).isSuccess).toBe(true);
  await sleep(1500);
}

async function failures(user: SessionUser, payload: unknown = {}): Promise<FailureRow[]> {
  const res = await post("/api/query", user, { type: JobQueries.failures, payload });
  const body = await res.json();
  expect(res.status, JSON.stringify(body)).toBe(200);
  return body.data.rows;
}

describe("jobs:query:failures (fw#3079)", () => {
  test("the triggering tenant reads its own failed job, scoped by subject", async () => {
    await generate(userA, "campaign-1", "fail");
    await generate(userA, "campaign-2", "budget");

    const rows = await failures(userA);
    expect(rows).toHaveLength(2);
    const byCampaign = new Map(rows.map((row) => [row.subject?.["campaignId"], row]));
    expect(byCampaign.get("campaign-1")?.jobName).toBe("app:job:generate-texts");
    // Plain Error → the key declared at the job.
    expect(byCampaign.get("campaign-1")?.messageKey).toBe(DECLARED_KEY);
    // KumikoError → its own i18nKey wins over the declared fallback.
    expect(byCampaign.get("campaign-2")?.messageKey).toBe(BUDGET_KEY);
  });

  test("another tenant sees none of them, and only its own", async () => {
    expect(await failures(userB)).toHaveLength(0);

    await generate(userB, "campaign-1", "fail");

    const rowsB = await failures(userB);
    expect(rowsB).toHaveLength(1);
    expect(rowsB[0]?.subject?.["campaignId"]).toBe("campaign-1");
    // Tenant A's two records are untouched by B's own run of the same job
    // and the same campaign id.
    expect(await failures(userA)).toHaveLength(2);
  });

  test("no provider message reaches the tenant", async () => {
    const res = await post("/api/query", userA, { type: JobQueries.failures, payload: {} });
    const raw = await res.text();
    expect(raw).toContain(DECLARED_KEY);
    expect(raw).not.toContain(PROVIDER_MESSAGE);
    expect(raw).not.toContain("openai");
  });

  test("a later successful run of the same subject clears the record", async () => {
    await generate(userA, "campaign-1", "succeed");

    const rows = await failures(userA);
    expect(rows.map((row) => row.subject?.["campaignId"])).toEqual(["campaign-2"]);
  });

  test("only the final attempt records — a retried job leaves one record", async () => {
    const res = await post("/api/write", userB, { type: "app:write:start-flaky", payload: {} });
    expect((await res.json()).isSuccess).toBe(true);
    await sleep(2500);

    const rows = await failures(userB, { jobName: "app:job:flaky" });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.subject).toBeNull();

    // Both attempts did land as their own failed run — the single record
    // above is the final-attempt gate, not a missing second attempt.
    const runs = await selectMany(db, jobRunsTable, { jobName: "app:job:flaky" });
    expect(runs).toHaveLength(2);
  });

  test("the subject filter selects one record", async () => {
    const rows = await failures(userA, { subject: { campaignId: "campaign-2" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.messageKey).toBe(BUDGET_KEY);

    expect(await failures(userA, { subject: { campaignId: "campaign-unknown" } })).toHaveLength(0);
  });

  test("SystemAdmin still sees every tenant's run with its provider message", async () => {
    const res = await post("/api/query", systemAdmin, {
      type: JobQueries.list,
      payload: { jobName: "app:job:generate-texts", status: "failed" },
    });
    const raw = await res.text();
    expect(res.status, raw).toBe(200);

    // Both of tenant A's failures plus tenant B's — the tenant-visible record
    // is an addition, it takes nothing away from the SystemAdmin view.
    expect(JSON.parse(raw).data.rows).toHaveLength(3);
    expect(raw).toContain(PROVIDER_MESSAGE);
  });
  test("a corrupt stored subject degrades to null instead of failing the list", async () => {
    await insertOne(db, tenantJobFailuresTable, {
      tenantId: tenantB,
      jobName: "app:job:corrupt",
      subject: '{"campaignId":"not-an-entry-array"}',
      messageKey: DECLARED_KEY,
      failedAt: Temporal.Now.instant(),
    });

    const rows = await failures(userB, { jobName: "app:job:corrupt" });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.subject).toBeNull();
  });
});
