// Regression guard for startDevJobRunners' lane default: a job registered
// WITHOUT an explicit runIn used to get no consumer at all in the dev server
// (the old `lanes` filter dropped `undefined` lanes), so it sat in the queue
// forever. `runners.length` alone can't catch that — a lane with no consumer
// still produces a runner object. This dispatches a real job and waits for
// its side effect to prove the lane is actually being consumed.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
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
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createDispatcher } from "@cosmicdrift/kumiko-framework/pipeline";
import {
  createTestDb,
  createTestRedis,
  setupTestStack,
  type TestDb,
  type TestRedis,
  TestUsers,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { waitFor } from "@cosmicdrift/kumiko-framework/testing";
import { z } from "zod";
import { startDevJobRunners } from "../job-run-logger";

let testDb: TestDb;
let testRedis: TestRedis;
let db: DbConnection;

const jobRuns: Array<{ readonly note: string }> = [];

// No `runIn` — the exact case the lane-default regression hits.
const probeFeature = defineFeature("probe", (r) => {
  r.job("noteIt", { trigger: { manual: true } }, async (payload) => {
    jobRuns.push({ note: (payload as { note: string }).note });
  });
});

beforeAll(async () => {
  testDb = await createTestDb();
  testRedis = await createTestRedis();
  db = testDb.db;
  await unsafePushTables(db, { jobRunsTable, jobRunLogsTable });
  await createEventsTable(db);
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
      // Construction-only — this job never calls ctx.write/ctx.queryAs, so a
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

// kumiko-framework#2553: startDevJobRunners built its per-lane JobRunners but
// never called attachDispatcher() on them (unlike createApiEntrypoint /
// createWorkerEntrypoint / createAllInOneEntrypoint, which all do this
// automatically) — so ctx.write/ctx.queryAs inside a dev-run job always hit
// the "dispatcher attached — call attachDispatcher() first" stub. This
// mirrors create-kumiko-server.ts's real wiring (setupTestStack + a separate
// startDevJobRunners as the lane consumer) and drives a job that calls both
// ctx.write and ctx.queryAs end-to-end.
const attachNoteEntity = createEntity({
  table: "job_attach_notes",
  fields: { text: createTextField({ required: true }) },
});
const attachNoteTable = buildEntityTable("note", attachNoteEntity);

const attachResults: Array<{ writeOk: boolean; rowCount: number }> = [];
const attachFailures: string[] = [];

const attachDispatcherFeature = defineFeature("jobattach", (r) => {
  r.entity("note", attachNoteEntity);

  r.writeHandler(
    "create",
    z.object({ text: z.string() }),
    async (event, ctx) => {
      const crud = createEventStoreExecutor(attachNoteTable, attachNoteEntity, {
        entityName: "note",
      });
      return crud.create(event.payload, event.user, ctx.db);
    },
    { access: { openToAll: true } },
  );

  r.queryHandler("list", z.object({}), async (_query, ctx) => selectMany(ctx.db, attachNoteTable), {
    access: { openToAll: true },
  });

  r.job("record", { trigger: { manual: true }, retries: 0 }, async (payload, ctx) => {
    try {
      const text = (payload as { text: string }).text;
      const writeResult = await ctx.write("jobattach:write:create", { text });
      const rows = await ctx.queryAs(TestUsers.admin, "jobattach:query:list", {});
      attachResults.push({
        writeOk: writeResult.isSuccess,
        rowCount: (rows as unknown[]).length,
      });
    } catch (error) {
      attachFailures.push(error instanceof Error ? error.message : String(error));
      throw error;
    }
  });
});

describe("startDevJobRunners attaches the dispatcher (kumiko-framework#2553)", () => {
  afterEach(() => {
    attachResults.length = 0;
    attachFailures.length = 0;
  });

  test("a dev-run job's ctx.write and ctx.queryAs both succeed", async () => {
    const stack = await setupTestStack({
      features: [attachDispatcherFeature, createJobsFeature()],
      // Enqueuer-only — startDevJobRunners below is the sole consumer,
      // mirroring create-kumiko-server.ts.
      jobs: {},
    });
    await unsafeCreateEntityTable(stack.db, attachNoteEntity);

    try {
      const { runners, stop } = await startDevJobRunners({
        registry: stack.registry,
        db: stack.db,
        context: stack.context,
        redisUrl: stack.redis.redisUrl,
        dispatcher: stack.dispatcher,
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
  }, 15000);
});
