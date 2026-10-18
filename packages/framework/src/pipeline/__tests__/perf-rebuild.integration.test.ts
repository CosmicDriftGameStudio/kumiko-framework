// Projection-Rebuild volume — deterministic, no wall-clock threshold.
//
// Replays 10k seeded events through the real rebuildProjection() pipeline
// (registry + state table + status-lifecycle wrapper) and asserts exact
// counts: events consumed, apply calls per event type, the resulting
// counter row, and the number of batch reads. A rebuild that drops, repeats
// or re-batches events fails here regardless of how fast the host is.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { testDatabaseUrl } from "@cosmicdrift/kumiko-testing/helpers";
import { unsafePushTables } from "@cosmicdrift/kumiko-testing/stack";
import postgres from "postgres";
import { type BunTestDb, createTestDb } from "../../db/__tests__/query/bun-test-db.ts";
import { integer, table as pgTable, uuid as pgUuid } from "../../db/dialect.ts";
import { asRawClient } from "../../db/query.ts";
import {
  createEntity,
  createRegistry,
  createTextField,
  defineFeature,
} from "../../engine/index.ts";
import type { ProjectionDefinition } from "../../engine/types/index.ts";
import { createProjectionStateTable, rebuildProjection } from "../../pipeline/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import { ensureTemporalPolyfill } from "../../time/polyfill.ts";
import { generateId as uuid } from "../../utils/index.ts";
import { REBUILD_BATCH_SIZE } from "../projection-rebuild.ts";

// Counter projection: every task.created bumps a counter, every
// task.updated is a no-op. Enough to exercise the apply path —
// rebuild cost is dominated by event iteration + apply dispatch,
// not the projection state shape.
const taskCountTable = pgTable("read_perf_rebuild_task_count", {
  tenantId: pgUuid("tenant_id").primaryKey(),
  count: integer("count").notNull().default(0),
});

const applyCalls = { created: 0, updated: 0 };

const taskCountProjection: ProjectionDefinition = {
  name: "task-count",
  source: "task",
  table: taskCountTable,
  apply: {
    "task.created": async (event, tx) => {
      applyCalls.created++;
      await asRawClient(tx).unsafe(
        `INSERT INTO "read_perf_rebuild_task_count" (tenant_id, count) VALUES ($1, 1) ON CONFLICT (tenant_id) DO UPDATE SET count = read_perf_rebuild_task_count.count + 1`,
        [event.tenantId],
      );
    },
    "task.updated": async (_event, _tx) => {
      applyCalls.updated++;
    },
  },
};

const taskEntity = createEntity({
  table: "perf_rebuild_tasks",
  fields: { title: createTextField({ personal: false, reason: "test_fixture", required: true }) },
});

const feature = defineFeature("perfrebuild", (r) => {
  r.entity({ name: "task", ...taskEntity });
  r.projection(taskCountProjection);
});

const admin = TestUsers.admin;
let testDb: BunTestDb;
let observedDb: ReturnType<typeof postgres>;
const batchReadLimits: unknown[] = [];
const registry = createRegistry([feature]);
const qualifiedProjectionName = "perfrebuild:projection:task-count";

beforeAll(async () => {
  await ensureTemporalPolyfill();
  testDb = await createTestDb();
  await createProjectionStateTable(testDb.db);
  await unsafePushTables(testDb.db, { perf_rebuild_task_count: taskCountTable });
  // postgres-js reports every statement through `debug`; the rebuild runs on this
  // connection so its batch SELECTs can be counted without a production hook.
  observedDb = postgres(testDatabaseUrl().replace(/\/[^/]+$/, `/${testDb.dbName}`), {
    max: 2,
    debug: (_connection, query, parameters) => {
      if (isRebuildBatchRead(query)) batchReadLimits.push(parameters[3]);
    },
  });
});

afterAll(async () => {
  await observedDb.end({ timeout: 5 });
  await testDb.cleanup();
});

function isRebuildBatchRead(query: string): boolean {
  return query.includes('FROM "kumiko_events" e') && query.includes("LIMIT $4");
}

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

describe("rebuildProjection volume", () => {
  test("replays 10000 events exactly once and reads them in batches", async () => {
    await seedEvents(2000, 5);
    applyCalls.created = 0;
    applyCalls.updated = 0;
    batchReadLimits.length = 0;
    let shadowBuilds = 0;

    const result = await rebuildProjection(qualifiedProjectionName, {
      db: observedDb,
      registry,
      __test_onBuildShadowTable: () => {
        shadowBuilds++;
      },
    });

    expect(result.eventsProcessed).toBe(10_000);
    expect(result.eventsSkipped).toBe(0);
    expect(applyCalls).toEqual({ created: 2000, updated: 8000 });
    expect(shadowBuilds).toBe(1);

    const rows = await asRawClient(testDb.db).unsafe(
      `SELECT count FROM read_perf_rebuild_task_count WHERE tenant_id = $1`,
      [admin.tenantId],
    );
    expect(rows).toEqual([{ count: 2000 }]);

    // Each batch SELECT carries the same LIMIT. 10000 events fill ceil(10000 / REBUILD_BATCH_SIZE)
    // batches. +2: the unlocked drain ends on one short probe read, and the fenced final drain
    // after the cutover fence issues one more.
    expect(new Set(batchReadLimits)).toEqual(new Set([REBUILD_BATCH_SIZE]));
    expect(batchReadLimits).toHaveLength(Math.ceil(10_000 / REBUILD_BATCH_SIZE) + 2);
  });
});
