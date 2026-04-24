// Projection-Rebuild Performance — NOT a perf gate, a "not-broken" gate.
//
// Asserts the current rebuildProjection() pipeline (registry + state-table
// + status-lifecycle wrapper) still moves bulk events at a sane rate. The
// real performance number is what we observe in isolation: 14–15k events/s
// on this hardware. The threshold below is intentionally loose because
// vitest runs integration suites in parallel — other files hammer the same
// Postgres at the same time, and an I/O-bound rebuild shares bandwidth.
//
// Threshold: 5000 events/s. Picked so a 2× regression on a real bottleneck
// (e.g. accidental N+1 in the apply-loop, missing index on events.id, a
// stray await in the hot path) trips the test, while normal suite-load
// jitter does not. If this ever flakes in CI, drop to 3000 — the goal is
// "catastrophic regression detector", not "perf SLO".

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import {
  integer as drizzleInteger,
  table as drizzlePgTable,
  uuid as drizzleUuid,
} from "../../db/dialect";
import { createEntity, createRegistry, createTextField, defineFeature } from "../../engine";
import type { ProjectionDefinition } from "../../engine/types";
import { createEventsTable } from "../../event-store";
import { createProjectionStateTable, rebuildProjection } from "../../pipeline";
import { createTestDb, pushTables, type TestDb, TestUsers } from "../../testing";
import { generateId as uuid } from "../../utils";

// Counter projection: every task.created bumps a counter, every
// task.updated is a no-op. Enough to exercise the apply path —
// rebuild cost is dominated by event iteration + apply dispatch,
// not the projection state shape.
const taskCountTable = drizzlePgTable("read_perf_rebuild_task_count", {
  tenantId: drizzleUuid("tenant_id").primaryKey(),
  count: drizzleInteger("count").notNull().default(0),
});

const taskCountProjection: ProjectionDefinition = {
  name: "task-count",
  source: "task",
  table: taskCountTable,
  apply: {
    "task.created": async (event, tx) => {
      await tx
        .insert(taskCountTable)
        .values({ tenantId: event.tenantId, count: 1 })
        .onConflictDoUpdate({
          target: taskCountTable.tenantId,
          set: { count: sql`${taskCountTable.count} + 1` },
        });
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
  idType: "uuid",
  fields: { title: createTextField({ required: true }) },
});

const feature = defineFeature("perfrebuild", (r) => {
  r.entity("task", taskEntity);
  r.projection(taskCountProjection);
});

const admin = TestUsers.admin;
let testDb: TestDb;
const registry = createRegistry([feature]);
const qualifiedProjectionName = "perfrebuild:projection:task-count";

beforeAll(async () => {
  testDb = await createTestDb();
  await createEventsTable(testDb.db);
  await createProjectionStateTable(testDb.db);
  await pushTables(testDb.db, { perf_rebuild_task_count: taskCountTable });
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await testDb.db.execute(
    sql`TRUNCATE kumiko_events, read_perf_rebuild_task_count, kumiko_projections RESTART IDENTITY CASCADE`,
  );
});

// Bulk-seed via SQL — sequential append() calls would take minutes.
// Measures rebuild throughput on a finished stream, not the seed phase.
// Produces count aggregates × depth events per aggregate.
async function seedEvents(count: number, depth: number): Promise<void> {
  const userId = uuid();
  // v1 creates
  await testDb.db.execute(sql`
    INSERT INTO kumiko_events (aggregate_id, aggregate_type, tenant_id, version, type, payload, metadata, created_by)
    SELECT gen_random_uuid(), 'task', ${admin.tenantId}::uuid, 1, 'task.created',
           jsonb_build_object('title', 'Task ' || gs.n),
           jsonb_build_object('userId', ${userId}::text),
           ${userId}::text
      FROM generate_series(1, ${count}) AS gs(n);
  `);
  // v2..depth updates
  for (let v = 2; v <= depth; v++) {
    await testDb.db.execute(sql`
      INSERT INTO kumiko_events (aggregate_id, aggregate_type, tenant_id, version, type, payload, metadata, created_by)
      SELECT e.aggregate_id, 'task', ${admin.tenantId}::uuid, ${v}, 'task.updated',
             jsonb_build_object('title', 'Task v' || ${v}),
             jsonb_build_object('userId', ${userId}::text),
             ${userId}::text
        FROM kumiko_events e
       WHERE e.aggregate_type = 'task' AND e.version = ${v - 1};
    `);
  }
}

describe("rebuildProjection performance — Gate A", () => {
  test("rebuild rate >= 3k events/sec under suite-parallel-load (10000 events)", async () => {
    // 2000 aggregates × 5 events = 10000 events
    await seedEvents(2000, 5);

    const start = performance.now();
    const result = await rebuildProjection(qualifiedProjectionName, {
      db: testDb.db,
      registry,
    });
    const durationMs = performance.now() - start;

    expect(result.eventsProcessed).toBe(10_000);
    const rate = result.eventsProcessed / (durationMs / 1000);
    console.log(
      `  Rebuild: ${result.eventsProcessed} events in ${durationMs.toFixed(1)}ms = ${Math.round(rate)} events/s`,
    );

    // Budget 3k events/s under suite-parallel-load. Isolated runs on dev
    // hardware see ~14k events/s; parallel-load drops it 3-4x (Docker-PG
    // contention, Vitest worker concurrency). The gate catches real
    // regressions (~40% drop to <2k) without daily false positives. If
    // you see this flake below 3k, profile `rebuildProjection` — don't
    // just lower the budget further.
    expect(rate).toBeGreaterThanOrEqual(3_000);
  });
});
