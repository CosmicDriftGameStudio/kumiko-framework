// Tenant-visible job run state (fw#3616) end to end: writes and direct
// dispatches enqueue jobs that opted in via tenantVisibleRun, and the tenant
// reads queued/running/completed/failed back through jobs:query:tenant-runs —
// over real HTTP, real BullMQ and a real Postgres with the real run-logger.
//
// Two runners share one queue prefix: an enqueuer-only runner (no worker) so
// the queued state stays observable until the consuming runner is started.

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
import {
  createJobRunner,
  type JobRunner,
  serializeJobSubject,
} from "@cosmicdrift/kumiko-framework/jobs";
import {
  createTestDb,
  createTestRedis,
  createTestUser,
  type TestDb,
  type TestRedis,
  testTenantId,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { waitFor } from "@cosmicdrift/kumiko-framework/testing";
import { UnrecoverableError } from "bullmq";
import type { Hono } from "hono";
import * as z from "zod";
import { JobQueries } from "../constants.js";
import { deleteStaleJobRuns } from "../db/queries/retention.js";
import { markStaleJobRunsFailed } from "../db/queries/stale-run-sweep.js";
import { createJobsFeature } from "../feature.js";
import { createJobRunLogger } from "../job-run-logger.js";
import { jobRunLogsTable, jobRunsTable } from "../job-run-table.js";
import { tenantJobFailuresTable } from "../tenant-job-failure-table.js";
import { tenantJobRunsTable } from "../tenant-job-run-table.js";

const JWT_SECRET = "tenant-job-runs-integration-secret-key-0123456789";
const PROVIDER_MESSAGE = "openai 429: prompt 'Herr Schmidt, Kennzeichen B-XY-123' rejected";

const tenantA = testTenantId(1);
const tenantB = testTenantId(2);
const userA = createTestUser({ id: 1, tenantId: tenantA, roles: ["Admin"] });
const userB = createTestUser({ id: 2, tenantId: tenantB, roles: ["Admin"] });

type Deferred = { readonly promise: Promise<void>; readonly resolve: () => void };
function deferred(): Deferred {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
const handlerStarted = deferred();
const handlerRelease = deferred();

const generateWrite = defineWriteHandler({
  name: "generate",
  description: "Test-only: starts the text generation for one campaign.",
  schema: z.object({ campaignId: z.string(), mode: z.enum(["fail", "hold", "succeed"]) }),
  access: { roles: ["Admin"] },
  handler: async (event) => ({ isSuccess: true as const, data: { ...event.payload } }),
});

const plainWrite = defineWriteHandler({
  name: "plain",
  description: "Test-only: starts a job without tenantVisibleRun.",
  schema: z.object({ campaignId: z.string() }),
  access: { roles: ["Admin"] },
  handler: async (event) => ({ isSuccess: true as const, data: { ...event.payload } }),
});

const appFeature = defineFeature("app", (r) => {
  r.writeHandler(generateWrite);
  r.writeHandler(plainWrite);

  r.job(
    "generateTexts",
    {
      trigger: { on: "app:write:generate" },
      tenantVisibleRun: { subjectFields: ["campaignId"] },
    },
    async (payload) => {
      if (payload["mode"] === "fail") throw new Error(PROVIDER_MESSAGE);
      if (payload["mode"] === "hold") {
        handlerStarted.resolve();
        await handlerRelease.promise;
      }
    },
  );

  r.job("plainJob", { trigger: { on: "app:write:plain" } }, async () => {});

  r.job(
    "unrecoverable",
    {
      trigger: { manual: true },
      retries: 2,
      tenantVisibleRun: {},
      tenantVisibleFailure: { messageKey: "app:errors.unrecoverable" },
    },
    async () => {
      throw new UnrecoverableError("no retry");
    },
  );

  r.job(
    "replacing",
    {
      trigger: { manual: true },
      concurrency: "replace",
      tenantVisibleRun: { subjectFields: ["campaignId"] },
    },
    async () => {},
  );
});

let testDb: TestDb;
let testRedis: TestRedis;
let db: DbConnection;
let app: Hono;
let jwt: JwtHelper;
let enqueuer: JobRunner;
let worker: JobRunner;

beforeAll(async () => {
  testDb = await createTestDb();
  testRedis = await createTestRedis();
  db = testDb.db;

  const registry = createRegistry([appFeature, createJobsFeature()]);
  await unsafePushTables(db, {
    jobRunsTable,
    jobRunLogsTable,
    tenantJobFailuresTable,
    tenantJobRunsTable,
  });

  const redisUrl = `redis://${testRedis.redis.options.host}:${testRedis.redis.options.port}/${testRedis.redis.options.db}`;
  const queueNamePrefix = `kumiko-tenant-job-runs-${Date.now()}`;
  enqueuer = createJobRunner({
    registry,
    context: { db },
    redisUrl,
    queueNamePrefix,
    ...createJobRunLogger({ db, registry }),
  });
  worker = createJobRunner({
    registry,
    context: { db },
    redisUrl,
    consumerLane: "worker",
    queueNamePrefix,
    ...createJobRunLogger({ db, registry }),
  });

  const server = buildServer({
    registry,
    context: { db, registry, jobRunner: enqueuer },
    jwtSecret: JWT_SECRET,
    dispatcherOptions: { jobRunner: enqueuer },
  });
  app = server.app;
  jwt = server.jwt;

  await enqueuer.start();
});

afterAll(async () => {
  await worker.stop();
  await enqueuer.stop();
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

type RunRow = {
  readonly jobName: string;
  readonly subject: Record<string, unknown> | null;
  readonly status: string;
  readonly queuedAt: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
};

async function runs(user: SessionUser, payload: unknown = {}): Promise<RunRow[]> {
  const res = await post("/api/query", user, { type: JobQueries.tenantRuns, payload });
  const body = await res.json();
  expect(res.status, JSON.stringify(body)).toBe(200);
  return body.data.rows;
}

function ofCampaign(user: SessionUser, campaignId: string): Promise<RunRow[]> {
  return runs(user, { jobName: "app:job:generate-texts", subject: { campaignId } });
}

async function generate(
  user: SessionUser,
  campaignId: string,
  mode: "fail" | "hold" | "succeed",
): Promise<void> {
  const res = await post("/api/write", user, {
    type: "app:write:generate",
    payload: { campaignId, mode },
  });
  expect((await res.json()).isSuccess).toBe(true);
}

describe("jobs:query:tenant-runs (fw#3616)", () => {
  test("a job that never starts (no worker running) reads as queued with queuedAt and no startedAt right after the enqueue", async () => {
    // Event-triggered (handleEvent)
    await generate(userA, "c1", "succeed");
    const [eventRun] = await ofCampaign(userA, "c1");
    expect(eventRun?.status).toBe("queued");
    expect(eventRun?.queuedAt).not.toBeNull();
    expect(eventRun?.startedAt).toBeNull();
    expect(eventRun?.finishedAt).toBeNull();

    // Direct dispatch (tenant from payload.tenantId)
    await enqueuer.dispatch("app:job:generate-texts", {
      tenantId: tenantA,
      campaignId: "c2",
      mode: "succeed",
    });
    expect((await ofCampaign(userA, "c2")).map((row) => row.status)).toEqual(["queued"]);
  });

  test("a job without tenantVisibleRun leaves no row", async () => {
    const res = await post("/api/write", userA, {
      type: "app:write:plain",
      payload: { campaignId: "c1" },
    });
    expect((await res.json()).isSuccess).toBe(true);
    expect(await runs(userA, { jobName: "app:job:plain-job" })).toHaveLength(0);
    expect(
      (await selectMany(db, tenantJobRunsTable, {})).filter(
        (row: { jobName: string }) => row.jobName === "app:job:plain-job",
      ),
    ).toHaveLength(0);
  });

  test("concurrency replace drops the removed waiting job's queued row", async () => {
    const payload = { tenantId: tenantA, campaignId: "r1" };
    const first = await enqueuer.dispatch("app:job:replacing", payload);
    const second = await enqueuer.dispatch("app:job:replacing", payload);
    expect(second).not.toBe(first);

    const rows = await selectMany<{ bullJobId: string }>(db, tenantJobRunsTable, {
      jobName: "app:job:replacing",
    });
    expect(rows.map((row) => row.bullJobId)).toEqual([second]);
  });

  test("a non-primitive subject does not break the enqueue and records no row", async () => {
    const id = await enqueuer.dispatch("app:job:generate-texts", {
      tenantId: tenantA,
      campaignId: { nested: true },
      mode: "succeed",
    });
    expect(id).not.toBe("unknown");
    expect(await runs(userA, { jobName: "app:job:generate-texts" })).toHaveLength(2);
  });

  test("completed after the worker runs, one finished row per subject", async () => {
    await worker.start();

    await waitFor(async () => {
      expect((await ofCampaign(userA, "c1")).map((row) => row.status)).toEqual(["completed"]);
    });
    const [first] = await ofCampaign(userA, "c1");
    expect(first?.startedAt).not.toBeNull();
    expect(first?.finishedAt).not.toBeNull();

    await generate(userA, "c1", "succeed");
    await waitFor(async () => {
      const rows = await ofCampaign(userA, "c1");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe("completed");
      expect(rows[0]?.finishedAt).not.toBe(first?.finishedAt);
    });
    expect(
      await selectMany(db, tenantJobRunsTable, {
        tenantId: tenantA,
        subject: serializeJobSubject({ campaignId: "c1" }),
      }),
    ).toHaveLength(1);
  });

  test("a running job reads as running, with its start time", async () => {
    await generate(userA, "c3", "hold");
    await handlerStarted.promise;

    const [running] = await ofCampaign(userA, "c3");
    expect(running?.status).toBe("running");
    expect(running?.startedAt).not.toBeNull();
    expect(running?.finishedAt).toBeNull();

    handlerRelease.resolve();
    await waitFor(async () => {
      expect((await ofCampaign(userA, "c3")).map((row) => row.status)).toEqual(["completed"]);
    });
  });

  test("a failed final attempt reads as failed without any error text", async () => {
    await generate(userA, "c4", "fail");
    await waitFor(async () => {
      expect((await ofCampaign(userA, "c4")).map((row) => row.status)).toEqual(["failed"]);
    });
    const res = await post("/api/query", userA, { type: JobQueries.tenantRuns, payload: {} });
    const raw = await res.text();
    expect(raw).not.toContain(PROVIDER_MESSAGE);
    expect(raw).not.toContain("openai");
  });

  test("an unrecoverable error with retries left reads as failed, not queued", async () => {
    await enqueuer.dispatch("app:job:unrecoverable", { tenantId: tenantA });
    await waitFor(async () => {
      expect(
        (await runs(userA, { jobName: "app:job:unrecoverable" })).map((row) => row.status),
      ).toEqual(["failed"]);
    });
    // tenantVisibleFailure records at once as well, not after the retry budget.
    expect(
      await selectMany(db, tenantJobFailuresTable, { jobName: "app:job:unrecoverable" }),
    ).toHaveLength(1);
  });

  test("rows carry exactly the documented keys", async () => {
    const rows = await runs(userA);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([
        "finishedAt",
        "jobName",
        "queuedAt",
        "startedAt",
        "status",
        "subject",
      ]);
    }
  });

  test("a fractional limit is rejected", async () => {
    const res = await post("/api/query", userA, {
      type: JobQueries.tenantRuns,
      payload: { limit: 2.5 },
    });
    expect(res.status).toBe(400);
  });

  test("another tenant sees nothing, and a tenantId in the payload is ignored", async () => {
    expect(await runs(userB)).toHaveLength(0);
    expect(await runs(userB, { tenantId: tenantA })).toHaveLength(0);

    await generate(userB, "c1", "succeed");
    await waitFor(async () => {
      expect((await ofCampaign(userB, "c1")).map((row) => row.status)).toEqual(["completed"]);
    });
    const withForeignTenantId = await runs(userB, { tenantId: tenantA });
    expect(withForeignTenantId.map((row) => row.subject?.["campaignId"])).toEqual(["c1"]);
    // Tenant A's own c1 run is untouched by B's run of the same subject.
    expect((await ofCampaign(userA, "c1")).map((row) => row.status)).toEqual(["completed"]);
  });
});

describe("tenant run state in the run-logger", () => {
  const logger = (registry: Parameters<typeof createJobRunLogger>[0]["registry"]) =>
    createJobRunLogger({ db, registry });
  const registry = createRegistry([appFeature, createJobsFeature()]);
  const job = "app:job:logger-probe";
  const finished = (finalAttempt: boolean) => ({
    tenantId: tenantA,
    finalAttempt,
    tenantVisibleRun: { subject: null },
  });
  const rowOf = async (bullJobId: string) =>
    (
      await selectMany<{ status: string; startedAt: unknown; finishedAt: unknown }>(
        db,
        tenantJobRunsTable,
        { bullJobId },
      )
    )[0];

  test("a retried failure goes back to queued, the final failure is failed", async () => {
    const cb = logger(registry);
    await cb.onJobQueued?.(job, "retry-1", { tenantId: tenantA, subject: null });
    await cb.onJobStart?.(job, "retry-1", {
      attempt: 1,
      tenantVisibleRun: { tenantId: tenantA, subject: null },
    });
    expect((await rowOf("retry-1"))?.status).toBe("running");

    await cb.onJobFailed?.(job, "retry-1", "boom", [], finished(false));
    const retrying = await rowOf("retry-1");
    expect(retrying?.status).toBe("queued");
    expect(retrying?.startedAt).toBeNull();

    await cb.onJobStart?.(job, "retry-1", {
      attempt: 2,
      tenantVisibleRun: { tenantId: tenantA, subject: null },
    });
    await cb.onJobFailed?.(job, "retry-1", "boom", [], finished(true));
    const failed = await rowOf("retry-1");
    expect(failed?.status).toBe("failed");
    expect(failed?.finishedAt).not.toBeNull();
  });

  test("the same job id queued twice, or queued after it started, stays one row", async () => {
    const cb = logger(registry);
    await cb.onJobQueued?.(job, "dup-1", { tenantId: tenantA, subject: null });
    await cb.onJobQueued?.(job, "dup-1", { tenantId: tenantA, subject: null });
    expect(await selectMany(db, tenantJobRunsTable, { bullJobId: "dup-1" })).toHaveLength(1);

    await cb.onJobStart?.(job, "dup-1", {
      tenantVisibleRun: { tenantId: tenantA, subject: null },
    });
    await cb.onJobQueued?.(job, "dup-1", { tenantId: tenantA, subject: null });
    expect((await rowOf("dup-1"))?.status).toBe("running");
  });

  test("a dropped queued job disappears, a running one does not", async () => {
    const cb = logger(registry);
    await cb.onJobQueued?.(job, "drop-1", { tenantId: tenantA, subject: null });
    await cb.onJobDropped?.(job, "drop-1");
    expect(await rowOf("drop-1")).toBeUndefined();

    await cb.onJobStart?.(job, "drop-2", {
      tenantVisibleRun: { tenantId: tenantA, subject: null },
    });
    await cb.onJobDropped?.(job, "drop-2");
    expect((await rowOf("drop-2"))?.status).toBe("running");
  });
});

describe("tenant run state housekeeping", () => {
  const hoursAgo = (hours: number) => Temporal.Now.instant().subtract({ hours });
  const seed = (
    bullJobId: string,
    status: "queued" | "running" | "completed" | "failed",
    hours: number,
  ) =>
    insertOne(db, tenantJobRunsTable, {
      tenantId: tenantA,
      jobName: "app:job:housekeeping",
      subject: null,
      bullJobId,
      status,
      queuedAt: hoursAgo(hours),
      startedAt: status === "queued" ? null : hoursAgo(hours),
      updatedAt: hoursAgo(hours),
    });
  const statusOf = async (bullJobId: string) =>
    (await selectMany<{ status: string }>(db, tenantJobRunsTable, { bullJobId }))[0]?.status;

  test("the stale sweep fails old running rows and drops old queued rows", async () => {
    await seed("sweep-running-old", "running", 48);
    await seed("sweep-running-new", "running", 1);
    await seed("sweep-queued-old", "queued", 48);
    await seed("sweep-queued-new", "queued", 1);
    await seed("sweep-completed-old", "completed", 48);

    await markStaleJobRunsFailed(db, 24);

    expect(await statusOf("sweep-running-old")).toBe("failed");
    expect(await statusOf("sweep-running-new")).toBe("running");
    expect(await statusOf("sweep-queued-old")).toBeUndefined();
    expect(await statusOf("sweep-queued-new")).toBe("queued");
    expect(await statusOf("sweep-completed-old")).toBe("completed");
  });

  test("retention purges old finished rows only", async () => {
    await seed("ret-completed-old", "completed", 24 * 40);
    await seed("ret-failed-old", "failed", 24 * 40);
    await seed("ret-completed-new", "completed", 24);
    await seed("ret-running-old", "running", 24 * 40);

    await deleteStaleJobRuns(db, 30);

    expect(await statusOf("ret-completed-old")).toBeUndefined();
    expect(await statusOf("ret-failed-old")).toBeUndefined();
    expect(await statusOf("ret-completed-new")).toBe("completed");
    expect(await statusOf("ret-running-old")).toBe("running");
  });
});
