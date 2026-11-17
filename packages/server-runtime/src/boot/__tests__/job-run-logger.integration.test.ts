// Regression guard for startDevJobRunners' lane default: a job registered
// WITHOUT an explicit runIn used to get no consumer at all in the dev server
// (the old `lanes` filter dropped `undefined` lanes), so it sat in the queue
// forever. `runners.length` alone can't catch that — a lane with no consumer
// still produces a runner object. This dispatches a real job and waits for
// its side effect to prove the lane is actually being consumed.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  createJobRunLogger,
  createJobsFeature,
  jobRunLogsTable,
  jobRunsTable,
} from "@cosmicdrift/kumiko-bundled-features/jobs";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  buildEntityTable,
  createEventStoreExecutor,
  selectMany,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createRegistry,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { createDispatcher } from "@cosmicdrift/kumiko-framework/pipeline";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import {
  createTestDb,
  createTestRedis,
  setupTestStack,
  type TestDb,
  type TestRedis,
  testRunQueueNamePrefix,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { startDevJobRunners } from "../job-run-logger.ts";

let testDb: TestDb;
let testRedis: TestRedis;
let db: DbConnection;

const jobRuns: Array<{ readonly note: string }> = [];

// No `runIn` — the exact case the lane-default regression hits.
const probeFeature = defineFeature("probe", (r) => {
  r.job({
    name: "noteIt",
    trigger: { manual: true },
    handler: async (payload) => {
      jobRuns.push({ note: (payload as { note: string }).note });
    },
  });
});

beforeAll(async () => {
  testDb = await createTestDb();
  testRedis = await createTestRedis();
  db = testDb.db;
  await unsafePushTables(db, { jobRunsTable, jobRunLogsTable });
});

afterAll(async () => {
  await testDb.cleanup();
  await testRedis.cleanup();
});

describe("startDevJobRunners", () => {
  test("job without explicit runIn gets a consumer and actually executes", async () => {
    const registry = createRegistry([probeFeature, createJobsFeature()]);

    const { runners, stop } = await startDevJobRunners({
      registry,
      db,
      context: {},
      redisUrl: testRedis.redisUrl,
      queueNamePrefix: testRunQueueNamePrefix("test-lane-default"),
      // Construction-only — this job never calls ctx.dispatch.write/ctx.dispatch.queryAs, so a
      // dispatcher built against a bare `{}` context is enough to satisfy
      // the (now required) opts.dispatcher without wiring a full stack.
      dispatcher: createDispatcher(registry, {}),
    });

    try {
      expect(runners.length).toBe(1);
      const runner = runners[0];
      if (runner === undefined) throw new Error("expected a runner");

      await runner.dispatch("probe:job:note-it", { note: "hello-from-dev-runner" });

      await waitFor(() => {
        expect(jobRuns.some((r) => r.note === "hello-from-dev-runner")).toBe(true);
      });
    } finally {
      await stop();
    }
  });
});

// startDevJobRunners once built its per-lane JobRunners but
// never called attachDispatcher() on them (unlike createApiEntrypoint /
// createWorkerEntrypoint / createAllInOneEntrypoint, which all do this
// automatically) — so ctx.dispatch.write/ctx.dispatch.queryAs inside a dev-run job always hit
// the "dispatcher attached — call attachDispatcher() first" stub. This
// mirrors create-kumiko-server.ts's real wiring (setupTestStack + a separate
// startDevJobRunners as the lane consumer) and drives a job that calls both
// ctx.dispatch.write and ctx.dispatch.queryAs end-to-end.
const attachNoteEntity = createEntity({
  name: "note",
  table: "job_attach_notes",
  // The job's dispatch.write lands on the system tenant; the tenant session must read it back.
  systemRowsReadable: true,
  fields: { text: createTextField({ personal: false, reason: "test_fixture", required: true }) },
});
const attachNoteTable = buildEntityTable(attachNoteEntity);

const attachJobPayload = z.object({ text: z.string() });
const attachListRows = z.array(z.object({ text: z.string() }));

const attachResults: Array<{ writeOk: boolean; rowCount: number }> = [];
const attachFailures: string[] = [];

const attachDispatcherFeature = defineFeature("jobattach", (r) => {
  r.entity(attachNoteEntity);

  r.writeHandler({
    name: "create",
    schema: z.object({ text: z.string() }),
    handler: async (event, ctx) => {
      const crud = createEventStoreExecutor(attachNoteTable, attachNoteEntity, {
        entityName: "note",
      });
      return crud.create(event.payload, event.user, ctx.db);
    },
    access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
  });

  r.queryHandler({
    name: "list",
    schema: z.object({}),
    handler: async (_query, ctx) => selectMany(ctx.db, attachNoteTable),
    access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
  });

  r.job({
    name: "record",
    trigger: { manual: true },
    retries: 0,
    escapeHatch: {
      reason: "test job reads the note list as a signed-in user",
      grants: ["systemIdentity"],
    },
    handler: async (payload, ctx) => {
      try {
        const { text } = attachJobPayload.parse(payload);
        const writeResult = await ctx.dispatch.write("jobattach:write:create", { text });
        const rows = await ctx.dispatch.queryAs(TestUsers.admin, "jobattach:query:list", {});
        attachResults.push({
          writeOk: writeResult.isSuccess,
          rowCount: attachListRows.parse(rows).length,
        });
      } catch (error) {
        attachFailures.push(error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
  });
});

describe("startDevJobRunners attaches the dispatcher", () => {
  afterEach(() => {
    attachResults.length = 0;
    attachFailures.length = 0;
  });

  test("a dev-run job's ctx.dispatch.write and ctx.dispatch.queryAs both succeed", async () => {
    const attachQueueNamePrefix = testRunQueueNamePrefix("test-attach-dispatcher");
    const stack = await setupTestStack({
      features: [attachDispatcherFeature, createJobsFeature()],
      // Enqueuer-only — startDevJobRunners below is the sole consumer,
      // mirroring create-kumiko-server.ts.
      jobs: { queueNamePrefix: attachQueueNamePrefix },
    });
    await unsafeCreateEntityTable(stack.db, attachNoteEntity);

    try {
      const { runners, stop } = await startDevJobRunners({
        registry: stack.registry,
        db: stack.db,
        context: stack.context,
        redisUrl: stack.redis.redisUrl,
        dispatcher: stack.dispatcher,
        queueNamePrefix: attachQueueNamePrefix,
      });

      try {
        const runner = runners[0];
        if (runner === undefined) throw new Error("expected a runner");

        await runner.dispatch("jobattach:job:record", { text: "hello-from-dev-runner" });

        await waitFor(() => {
          expect(attachResults.length + attachFailures.length).toBeGreaterThan(0);
        });
        if (attachFailures.length > 0) {
          throw new Error(`job failed: ${attachFailures.join(", ")}`);
        }
        expect(attachResults[0]).toEqual({ writeOk: true, rowCount: 1 });
      } finally {
        await stop();
      }
    } finally {
      await stack.cleanup();
    }
  });
});

// Regression guard for the shared-Redis job-queue-collision bug: two boots
// (e.g. two parallel dev/e2e servers) that don't set distinct
// queueNamePrefix values consume from the same BullMQ queue names and steal
// each other's jobs ("Unknown job: ..."). Both registries below register the
// SAME feature/job name on purpose — if the queues were shared, runner B
// would recognize and execute jobs meant for runner A (proving the
// collision), not just fail to run them. Distinct prefixes must keep every
// dispatched job on runner A's side.
describe("startDevJobRunners isolates queues by queueNamePrefix", () => {
  test("two runners with distinct prefixes on the same Redis don't cross-consume", async () => {
    const runsA: string[] = [];
    const runsB: string[] = [];

    const isoFeatureA = defineFeature("iso", (r) => {
      r.job({
        name: "mark",
        trigger: { manual: true },
        handler: async (payload) => {
          runsA.push((payload as { note: string }).note);
        },
      });
    });
    const isoFeatureB = defineFeature("iso", (r) => {
      r.job({
        name: "mark",
        trigger: { manual: true },
        handler: async (payload) => {
          runsB.push((payload as { note: string }).note);
        },
      });
    });

    const registryA = createRegistry([isoFeatureA, createJobsFeature()]);
    const registryB = createRegistry([isoFeatureB, createJobsFeature()]);

    const runnerA = await startDevJobRunners({
      registry: registryA,
      db,
      context: {},
      redisUrl: testRedis.redisUrl,
      queueNamePrefix: testRunQueueNamePrefix("test-iso-a"),
      dispatcher: createDispatcher(registryA, {}),
    });
    const runnerB = await startDevJobRunners({
      registry: registryB,
      db,
      context: {},
      redisUrl: testRedis.redisUrl,
      queueNamePrefix: testRunQueueNamePrefix("test-iso-b"),
      dispatcher: createDispatcher(registryB, {}),
    });

    try {
      const dispatchA = runnerA.runners[0];
      if (dispatchA === undefined) throw new Error("expected a runner for registry A");

      const notes = Array.from({ length: 10 }, (_, i) => `from-a-${i}`);
      for (const note of notes) {
        await dispatchA.dispatch("iso:job:mark", { note });
      }

      // If the queues were shared, some of these 10 jobs would land on
      // runner B instead — runsA would never reach length 10 and this
      // would time out rather than pass.
      await waitFor(() => {
        expect(runsA).toHaveLength(10);
      });
      expect(runsB).toEqual([]);
    } finally {
      await runnerA.stop();
      await runnerB.stop();
    }
  });
});

// BullMQ job ids are only unique per queue, so two jobs can complete under the
// same bullJobId; each run row must be resolved by (jobName, bullJobId).
describe("createJobRunLogger — run resolution", () => {
  const readRunStatuses = async (bullJobId: string) => {
    const rows = await selectMany<{ jobName: string; status: string }>(db, jobRunsTable, {
      bullJobId,
    });
    return Object.fromEntries(rows.map((r) => [r.jobName, r.status]));
  };

  test("completion resolves the run of its own job when another job shares the bullJobId", async () => {
    const logger = createJobRunLogger({
      db,
      registry: createRegistry([createJobsFeature()]),
    });
    await logger.onJobStart?.("probe:job:first", "shared-cached", {});
    await logger.onJobStart?.("probe:job:second", "shared-cached", {});

    await logger.onJobComplete?.("probe:job:first", "shared-cached", 5, []);

    expect(await readRunStatuses("shared-cached")).toEqual({
      "probe:job:first": "completed",
      "probe:job:second": "running",
    });
  });

  test("a cache miss falls back to the run of its own job, not any run with that bullJobId", async () => {
    const registry = createRegistry([createJobsFeature()]);
    const starter = createJobRunLogger({ db, registry });
    await starter.onJobStart?.("probe:job:other", "shared-uncached", {});
    await starter.onJobStart?.("probe:job:wanted", "shared-uncached", {});

    const freshLogger = createJobRunLogger({ db, registry });
    await freshLogger.onJobComplete?.("probe:job:wanted", "shared-uncached", 5, []);

    expect(await readRunStatuses("shared-uncached")).toEqual({
      "probe:job:other": "running",
      "probe:job:wanted": "completed",
    });
  });
});
