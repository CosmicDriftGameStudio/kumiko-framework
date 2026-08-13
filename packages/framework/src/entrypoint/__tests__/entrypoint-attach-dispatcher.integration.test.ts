// Regression test for framework#2044 — attachDispatcher() wiring.
//
// #2043 added JobContext.write/queryAs plus JobRunner.attachDispatcher(), but
// left the entrypoint factories unwired: nothing ever called
// attachDispatcher() on the JobRunners they build, so ctx.write inside a job
// always hit the throwing stub in production too. This test proves the
// wiring closes that gap (a job's ctx.write actually commits when run
// through a real entrypoint) and that the gap is real (the same job, run
// against a bare createJobRunner() with no attachDispatcher() call, still
// throws the #2043 stub).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { z } from "zod";
import { type BunTestDb, createTestDb } from "../../bun-db/__tests__/bun-test-db";
import { asRawClient } from "../../db/query";
import { createRegistry, defineFeature } from "../../engine";
import { createArchivedStreamsTable, createEventsTable } from "../../event-store";
import { createJobRunner } from "../../jobs/job-runner";
import { createEventConsumerStateTable } from "../../pipeline";
import { createTestRedis, type TestRedis } from "../../stack";
import { waitFor } from "../../testing";
import { createWorkerEntrypoint } from "../index";

const writeProbeResults: Array<{ isSuccess: boolean }> = [];
const writeProbeFailures: string[] = [];

const writeProbeFeature = defineFeature("writeProbe", (r) => {
  const noted = r.defineEvent("noted", z.object({ note: z.string() }), { version: 1 });
  r.writeHandler(
    "note",
    z.object({ note: z.string() }),
    async (event, ctx) => {
      await ctx.unsafeAppendEvent({
        aggregateId: crypto.randomUUID(),
        aggregateType: "write-probe-note",
        type: noted.name,
        payload: { note: event.payload.note },
      });
      return { isSuccess: true as const, data: { note: event.payload.note } };
    },
    { access: { openToAll: true } },
  );
  r.job("write-via-job", { trigger: { manual: true }, retries: 0 }, async (payload, ctx) => {
    try {
      const result = await ctx.write("write-probe:write:note", {
        note: payload["note"] as string,
      });
      writeProbeResults.push({ isSuccess: result.isSuccess });
    } catch (error) {
      writeProbeFailures.push(error instanceof Error ? error.message : String(error));
      throw error;
    }
  });
});

const JWT = "attach-dispatcher-test-secret-must-be-32-chars!";

let testDb: BunTestDb;
let testRedis: TestRedis;

beforeAll(async () => {
  [testDb, testRedis] = await Promise.all([createTestDb(), createTestRedis()]);
  await createEventsTable(testDb.db);
  await createArchivedStreamsTable(testDb.db);
  await createEventConsumerStateTable(testDb.db);
});

afterAll(async () => {
  await Promise.all([testDb.cleanup(), testRedis.cleanup()]);
});

function uniquePrefix(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("createWorkerEntrypoint auto-wires attachDispatcher() (framework#2044)", () => {
  test("ctx.write inside a job commits end-to-end through a real entrypoint", async () => {
    writeProbeResults.length = 0;
    const registry = createRegistry([writeProbeFeature]);
    const redisUrl = `redis://${testRedis.redis.options.host}:${testRedis.redis.options.port}/${testRedis.redis.options.db}`;
    const worker = createWorkerEntrypoint({
      registry,
      context: { db: testDb.db, redis: testRedis.redis },
      jwtSecret: JWT,
      redisUrl,
      queueNamePrefix: uniquePrefix("attach-dispatcher"),
    });

    await worker.start();
    try {
      await worker.jobRunner.dispatch("write-probe:job:write-via-job", {
        note: "written from the job",
      });

      await waitFor(() => {
        expect(writeProbeResults.length).toBe(1);
        expect(writeProbeResults[0]?.isSuccess).toBe(true);
      });

      const rows = await asRawClient(testDb.db).unsafe(
        `SELECT payload FROM kumiko_events WHERE type = 'write-probe:event:noted'`,
      );
      expect(rows).toHaveLength(1);
      expect((rows[0] as { payload: { note: string } }).payload.note).toBe("written from the job");
    } finally {
      await worker.stop();
    }
  });
});

describe("createJobRunner without attachDispatcher() still hits the #2043 stub", () => {
  test("ctx.write throws — proves the entrypoint's attachDispatcher() call is the thing that makes writes work", async () => {
    writeProbeFailures.length = 0;
    const registry = createRegistry([writeProbeFeature]);
    const redisUrl = `redis://${testRedis.redis.options.host}:${testRedis.redis.options.port}/${testRedis.redis.options.db}`;
    const runner = createJobRunner({
      registry,
      context: { db: testDb.db, redis: testRedis.redis },
      redisUrl,
      consumerLane: "worker",
      queueNamePrefix: uniquePrefix("attach-dispatcher-bare"),
    });

    await runner.start();
    try {
      await runner.dispatch("write-probe:job:write-via-job", { note: "should never land" });

      await waitFor(() => {
        expect(writeProbeFailures.length).toBe(1);
      });
      expect(writeProbeFailures[0]).toContain(
        "JobContext.write called before dispatcher attached — call attachDispatcher() first",
      );
    } finally {
      await runner.stop();
    }
  });
});
