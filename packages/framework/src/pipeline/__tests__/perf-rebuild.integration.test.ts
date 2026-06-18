// Projection-Rebuild Performance — NOT a perf gate, a "not-broken" gate.
//
// Asserts the current rebuildProjection() pipeline (registry + state-table
// + status-lifecycle wrapper) still moves bulk events at a sane rate. The
// real performance number is what we observe in isolation: 14–15k events/s
// on this hardware. The threshold below is intentionally loose because
// vitest runs integration suites in parallel — other files hammer the same
// Postgres at the same time, and an I/O-bound rebuild shares bandwidth.
//
// Threshold: 1500 events/s (median of 3 rebuilds). Catches ~3× regressions;
// cdgs-runner under Docker-PG typically lands ~2–4k, isolated dev ~14k.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { type BunTestDb, createTestDb } from "../../bun-db/__tests__/bun-test-db";
import { integer, table as pgTable, uuid as pgUuid } from "../../db/dialect";
import { asRawClient } from "../../db/query";
import { createEntity, createRegistry, createTextField, defineFeature } from "../../engine";
import type { ProjectionDefinition } from "../../engine/types";
import { createEventsTable } from "../../event-store";
import { createProjectionStateTable, rebuildProjection } from "../../pipeline";
import { TestUsers, unsafePushTables } from "../../stack";
import { ensureTemporalPolyfill } from "../../time/polyfill";
import { generateId as uuid } from "../../utils";

// Counter projection: every task.created bumps a counter, every
// task.updated is a no-op. Enough to exercise the apply path —
// rebuild cost is dominated by event iteration + apply dispatch,
// not the projection state shape.
const taskCountTable = pgTable("read_perf_rebuild_task_count", {
  tenantId: pgUuid("tenant_id").primaryKey(),
  count: integer("count").notNull().default(0),
});

const taskCountProjection: ProjectionDefinition = {
  name: "task-count",
  source: "task",
  table: taskCountTable,
  apply: {
    "task.created": async (event, tx) => {
      await asRawClient(tx).unsafe(
        `INSERT INTO "read_perf_rebuild_task_count" (tenant_id, count) VALUES ($1, 1) ON CONFLICT (tenant_id) DO UPDATE SET count = read_perf_rebuild_task_count.count + 1`,
        [event.tenantId],
      );
    },
    "task.updated": async (_event, _tx) => {
      // No-op apply — measuring event-iteration overhead, not per-event
      // DB roundtrips. 10k events/s with one row-update per event would
      // be an I/O-bound test, not a rebuild-throughput test.
    },
  },
};

const taskEntity = createEntity({
  table: "perf_rebuild_tasks",
  fields: { title: createTextField({ required: true }) },
});

const feature = defineFeature("perfrebuild", (r) => {
  r.entity("task", taskEntity);
  r.projection(taskCountProjection);
});

const admin = TestUsers.admin;
let testDb: BunTestDb;
const registry = createRegistry([feature]);
const qualifiedProjectionName = "perfrebuild:projection:task-count";

beforeAll(async () => {
  await ensureTemporalPolyfill();
  testDb = await createTestDb();
  await createEventsTable(testDb.db);
  await createProjectionStateTable(testDb.db);
  await unsafePushTables(testDb.db, { perf_rebuild_task_count: taskCountTable });
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await asRawClient(testDb.db).unsafe(
    `TRUNCATE kumiko_events, read_perf_rebuild_task_count, kumiko_projections RESTART IDENTITY CASCADE`,
  );
});

// Bulk-seed via SQL — sequential append() calls would take minutes.
// Measures rebuild throughput on a finished stream, not the seed phase.
// Produces count aggregates × depth events per aggregate.
async function seedEvents(count: number, depth: number): Promise<void> {
  const userId = uuid();
  // v1 creates
  await asRawClient(testDb.db).unsafe(
    `
    INSERT INTO kumiko_events (aggregate_id, aggregate_type, tenant_id, version, type, payload, metadata, created_by)
    SELECT gen_random_uuid(), 'task', $1::uuid, 1, 'task.created',
           jsonb_build_object('title', 'Task ' || gs.n),
           jsonb_build_object('userId', $2::text),
           $3::text
      FROM generate_series(1, $4) AS gs(n);
  `,
    [admin.tenantId, userId, userId, count],
  );
  // v2..depth updates
  for (let v = 2; v <= depth; v++) {
    await asRawClient(testDb.db).unsafe(
      `
      INSERT INTO kumiko_events (aggregate_id, aggregate_type, tenant_id, version, type, payload, metadata, created_by)
      SELECT e.aggregate_id, 'task', $1::uuid, $2, 'task.updated',
             jsonb_build_object('title', 'Task v' || $3),
             jsonb_build_object('userId', $4::text),
             $5::text
        FROM kumiko_events e
       WHERE e.aggregate_type = 'task' AND e.version = $6;
    `,
      [admin.tenantId, v, v, userId, userId, v - 1],
    );
  }
}

describe("rebuildProjection performance — Gate A", () => {
  test("rebuild rate >= 1.5k events/sec (median of 3 runs, 10000 events)", async () => {
    await seedEvents(2000, 5);

    const rates: number[] = [];
    for (let run = 0; run < 3; run++) {
      await asRawClient(testDb.db).unsafe(
        `TRUNCATE read_perf_rebuild_task_count, kumiko_projections RESTART IDENTITY CASCADE`,
      );

      const start = performance.now();
      const result = await rebuildProjection(qualifiedProjectionName, {
        db: testDb.db,
        registry,
      });
      const durationMs = performance.now() - start;

      expect(result.eventsProcessed).toBe(10_000);
      rates.push(result.eventsProcessed / (durationMs / 1000));
    }

    rates.sort((a, b) => a - b);
    const median = rates[Math.floor(rates.length / 2)] ?? 0;
    console.log(
      `  Rebuild median: ${Math.round(median)} events/s (samples: ${rates.map((r) => Math.round(r)).join(", ")})`,
    );

    expect(median).toBeGreaterThanOrEqual(1_500);
  });
});
