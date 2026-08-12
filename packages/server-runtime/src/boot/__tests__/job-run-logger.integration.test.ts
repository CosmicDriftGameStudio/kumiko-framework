// Regression guard for startDevJobRunners' lane default: a job registered
// WITHOUT an explicit runIn used to get no consumer at all in the dev server
// (the old `lanes` filter dropped `undefined` lanes), so it sat in the queue
// forever. `runners.length` alone can't catch that — a lane with no consumer
// still produces a runner object. This dispatches a real job and waits for
// its side effect to prove the lane is actually being consumed.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createJobsFeature,
  jobRunLogsTable,
  jobRunsTable,
} from "@cosmicdrift/kumiko-bundled-features/jobs";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { createRegistry, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestDb,
  createTestRedis,
  type TestDb,
  type TestRedis,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { waitFor } from "@cosmicdrift/kumiko-framework/testing";
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
