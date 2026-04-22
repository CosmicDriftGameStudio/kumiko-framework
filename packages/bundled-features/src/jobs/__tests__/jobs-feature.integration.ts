import { buildServer, type JwtHelper } from "@kumiko/framework/api";
import type { DbConnection } from "@kumiko/framework/db";
import { createRegistry, defineFeature, type SessionUser } from "@kumiko/framework/engine";
import { createJobRunner, type JobRunner } from "@kumiko/framework/jobs";
import {
  createTestDb,
  createTestRedis,
  createTestUser,
  pushTables,
  sleep,
  type TestDb,
  type TestRedis,
  TestUsers,
} from "@kumiko/framework/testing";
import type { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { JobHandlers, JobQueries } from "../constants";
import { createJobRunLogger } from "../job-run-logger";
import { jobRunLogsTable, jobRunsTable } from "../job-run-table";
import { createJobsFeature } from "../jobs-feature";

// --- Setup ---

let testDb: TestDb;
let testRedis: TestRedis;
let db: DbConnection;
let app: Hono;
let jwt: JwtHelper;
let jobRunner: JobRunner;

const systemAdmin = TestUsers.systemAdmin;
const normalUser = createTestUser({ id: 2, roles: ["User"] });
const JWT_SECRET = "jobs-feature-test-secret-minimum-32-chars!!";

// Track job executions
const jobExecutions: Array<{ name: string; payload: Record<string, unknown> }> = [];

// Test feature with jobs
const appFeature = defineFeature("app", (r) => {
  // A job that succeeds and logs
  r.job("syncData", { trigger: { manual: true } }, async (payload, ctx) => {
    ctx.log?.info("Starting sync...");
    jobExecutions.push({ name: "app:job:sync-data", payload });
    ctx.log?.info(`Synced ${Object.keys(payload).length} fields`);
    ctx.log?.info("Sync complete");
  });

  // A job that fails
  r.job("failingImport", { trigger: { manual: true } }, async (_payload, ctx) => {
    ctx.log?.info("Connecting to import source...");
    throw new Error("import source unreachable");
  });

  // A boot job
  r.job("warmCache", { trigger: { manual: true }, runOnBoot: true }, async (payload) => {
    jobExecutions.push({ name: "app:job:warm-cache", payload });
  });
});

const jobsFeature = createJobsFeature();

beforeAll(async () => {
  testDb = await createTestDb();
  testRedis = await createTestRedis();
  db = testDb.db;

  await pushTables(db, { jobRunsTable, jobRunLogsTable });

  const registry = createRegistry([appFeature, jobsFeature]);
  const redisUrl = `redis://${testRedis.redis.options.host}:${testRedis.redis.options.port}/${testRedis.redis.options.db}`;
  const logger = createJobRunLogger(db);

  jobRunner = createJobRunner({
    registry,
    context: { db }, // jobRunner wired in after creation
    redisUrl,
    consumerLane: "worker",
    queueNamePrefix: `kumiko-jobs-feature-test-${Date.now()}`,
    ...logger,
  });

  // Wire jobRunner into context after creation
  const context = { db, registry, jobRunner };

  const server = buildServer({
    registry,
    context,
    jwtSecret: JWT_SECRET,
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
  return res.json();
}

// --- Scenario 1: Trigger a job, verify it runs and gets logged ---

describe("scenario 1: trigger job → JobRun logged", () => {
  test("SystemAdmin triggers a job via API", async () => {
    const result = await write(systemAdmin, JobHandlers.trigger, {
      jobName: "app:job:sync-data",
      payload: { source: "crm" },
    });
    expect(result.isSuccess).toBe(true);
    expect(result.data.jobName).toBe("app:job:sync-data");
    expect(result.data.bullJobId).toBeDefined();

    // Wait for BullMQ to process
    await sleep(1000);

    // Job actually ran
    const executed = jobExecutions.filter((e) => e.name === "app:job:sync-data");
    expect(executed.length).toBeGreaterThanOrEqual(1);
    expect(executed[0]?.payload).toEqual({ source: "crm" });
  });

  test("JobRun is logged in DB with status=completed", async () => {
    const result = await query(systemAdmin, JobQueries.list, { jobName: "app:job:sync-data" });
    const runs = result.data.rows;
    expect(runs.length).toBeGreaterThanOrEqual(1);

    const run = runs[0];
    expect(run.status).toBe("completed");
    expect(run.duration).toBeGreaterThanOrEqual(0);
    expect(run.finishedAt).toBeDefined();
  });
});

// --- Scenario 2: Failed job → status=failed with error ---

describe("scenario 2: failed job gets logged", () => {
  test("trigger a failing job", async () => {
    const result = await write(systemAdmin, JobHandlers.trigger, {
      jobName: "app:job:failing-import",
    });
    expect(result.isSuccess).toBe(true);

    // Wait for BullMQ to process and fail
    await sleep(1500);
  });

  test("JobRun has status=failed with error message", async () => {
    const result = await query(systemAdmin, JobQueries.list, {
      jobName: "app:job:failing-import",
      status: "failed",
    });
    const runs = result.data.rows;
    expect(runs.length).toBeGreaterThanOrEqual(1);

    const run = runs[0];
    expect(run.status).toBe("failed");
    expect(run.error).toContain("import source unreachable");
  });
});

// --- Scenario 3: jobs.list with filters ---

describe("scenario 3: jobs.list filters", () => {
  test("list all runs", async () => {
    const result = await query(systemAdmin, JobQueries.list, {});
    expect(result.data.rows.length).toBeGreaterThanOrEqual(2);
  });

  test("filter by status=completed", async () => {
    const result = await query(systemAdmin, JobQueries.list, { status: "completed" });
    for (const run of result.data.rows) {
      expect(run.status).toBe("completed");
    }
  });

  test("filter by jobName", async () => {
    const result = await query(systemAdmin, JobQueries.list, { jobName: "app:job:sync-data" });
    for (const run of result.data.rows) {
      expect(run.jobName).toBe("app:job:sync-data");
    }
  });
});

// --- Scenario 4: jobs.detail ---

describe("scenario 4: jobs.detail", () => {
  test("returns single job run with all fields", async () => {
    // Get first run from list
    const listResult = await query(systemAdmin, JobQueries.list, { jobName: "app:job:sync-data" });
    const runId = listResult.data.rows[0].id;

    const result = await query(systemAdmin, JobQueries.details, { runId });
    const run = result.data;
    expect(run).not.toBeNull();
    expect(run.id).toBe(runId);
    expect(run.jobName).toBe("app:job:sync-data");
    expect(run.status).toBe("completed");
    expect(run.duration).toBeDefined();
    expect(run.startedAt).toBeDefined();
    expect(run.finishedAt).toBeDefined();
  });

  test("detail includes log entries from ctx.log()", async () => {
    const listResult = await query(systemAdmin, JobQueries.list, { jobName: "app:job:sync-data" });
    const runId = listResult.data.rows[0].id;

    const result = await query(systemAdmin, JobQueries.details, { runId });
    const run = result.data;

    expect(run.logs).toBeDefined();
    expect(run.logs.length).toBe(3);
    expect(run.logs[0].level).toBe("info");
    expect(run.logs[0].message).toBe("Starting sync...");
    expect(run.logs[2].message).toBe("Sync complete");
  });

  test("failed job detail includes log entries before error", async () => {
    const listResult = await query(systemAdmin, JobQueries.list, {
      jobName: "app:job:failing-import",
      status: "failed",
    });
    const runId = listResult.data.rows[0].id;

    const result = await query(systemAdmin, JobQueries.details, { runId });
    const run = result.data;

    expect(run.logs.length).toBeGreaterThanOrEqual(2);
    // First log is the info from before the error
    expect(run.logs[0].message).toBe("Connecting to import source...");
    // Last log is the error itself
    const errorLog = run.logs.find((l: Record<string, unknown>) => l["level"] === "error");
    expect(errorLog).toBeDefined();
    expect(errorLog.message).toContain("import source unreachable");
  });

  test("returns null for non-existent run", async () => {
    const result = await query(systemAdmin, JobQueries.details, { runId: 99999 });
    expect(result.data).toBeNull();
  });
});

// --- Scenario 5: jobs.retry ---

describe("scenario 5: retry failed job", () => {
  test("retry creates a new job run", async () => {
    // Find the failed run
    const listResult = await query(systemAdmin, JobQueries.list, {
      jobName: "app:job:failing-import",
      status: "failed",
    });
    const failedRunId = listResult.data.rows[0].id;

    // Retry it
    const result = await write(systemAdmin, JobHandlers.retry, { runId: failedRunId });
    expect(result.isSuccess).toBe(true);
    expect(result.data.jobName).toBe("app:job:failing-import");
    expect(result.data.retriedFromRunId).toBe(failedRunId);

    // Wait for BullMQ to process (will fail again)
    await sleep(1500);

    // Should have a new run (also failed)
    const afterList = await query(systemAdmin, JobQueries.list, {
      jobName: "app:job:failing-import",
    });
    expect(afterList.data.rows.length).toBeGreaterThanOrEqual(2);
  });

  test("retry on non-failed job is rejected", async () => {
    const listResult = await query(systemAdmin, JobQueries.list, { status: "completed" });
    if (listResult.data.rows.length > 0) {
      const completedRunId = listResult.data.rows[0].id;
      const result = await write(systemAdmin, JobHandlers.retry, { runId: completedRunId });
      expect(result.isSuccess).toBe(false);
      expect(result.error.code).toBe("unprocessable");
      expect(result.error.details).toMatchObject({ reason: "only_failed_jobs_can_be_retried" });
    }
  });
});

// --- Access control ---

describe("access control", () => {
  test("normal user cannot trigger jobs", async () => {
    const res = await req("POST", "/api/write", normalUser, {
      type: JobHandlers.trigger,
      payload: { jobName: "app:job:sync-data" },
    });
    expect(res.status).toBe(403);
  });

  test("normal user cannot list job runs", async () => {
    const res = await req("POST", "/api/query", normalUser, {
      type: JobQueries.list,
      payload: {},
    });
    expect(res.status).not.toBe(200);
  });
});
