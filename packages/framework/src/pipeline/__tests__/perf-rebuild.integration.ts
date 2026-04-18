// Projection-Rebuild Performance — Gate A target aus Sprint-B-Spike.
// Validiert dass das heutige rebuildProjection() (mit r.projection +
// registry + rebuild-state-table + status-lifecycle) trotz framework-
// overhead den Throughput hält.
//
// Threshold: 5000 events/s im voll-Suite-Run. Isoliert (yarn vitest run
// dieses-file allein) sehen wir 14k-15k events/s. Vitest läuft Tests
// parallel — andere Files hämmern parallel die gleiche DB, I/O-bound
// rebuild teilt sich Bandwidth. 5k events/s ist die parallel-safe Grenze;
// unter dieser Zahl ist es eine echte Regression. Production-Last (eine
// Node, mehrere Tenants gleichzeitig) sieht ähnliches Profil.

import { sql } from "drizzle-orm";
import { v4 as uuid } from "uuid";
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

// Counter-Projection: jedes task.created bumpt einen counter, jedes
// task.updated touched lastUpdatedAt. Reicht um den apply-Pfad zu
// exercisen — der Rebuild-Cost-Anteil ist event-iteration + apply,
// nicht projection-state-shape.
const taskCountTable = drizzlePgTable("perf_rebuild_task_count", {
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
        // biome-ignore lint/suspicious/noExplicitAny: tx is DbRunner
        .insert(taskCountTable)
        .values({ tenantId: event.tenantId, count: 1 })
        .onConflictDoUpdate({
          target: taskCountTable.tenantId,
          set: { count: sql`${taskCountTable.count} + 1` },
        });
    },
    "task.updated": async (_event, _tx) => {
      // No-op apply — wir wollen den event-iteration-overhead messen, nicht
      // die per-event DB-Roundtrips. 10k events/s @ 1 row-update pro event
      // wäre ein I/O-bound test, nicht ein rebuild-throughput-test.
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
    sql`TRUNCATE events, perf_rebuild_task_count, kumiko_projections RESTART IDENTITY CASCADE`,
  );
});

// Bulk-Seed via SQL — sequenzielle append()-calls würden den Test minutenlang
// machen. Was wir messen ist die Rebuild-Throughput auf einem fertigen Stream,
// nicht den Seed-Vorgang. count Aggregate × depth Events pro Aggregate.
async function seedEvents(count: number, depth: number): Promise<void> {
  const userId = uuid();
  // v1 creates
  await testDb.db.execute(sql`
    INSERT INTO events (aggregate_id, aggregate_type, tenant_id, version, type, payload, metadata, created_by)
    SELECT gen_random_uuid(), 'task', ${admin.tenantId}::uuid, 1, 'task.created',
           jsonb_build_object('title', 'Task ' || gs.n),
           jsonb_build_object('userId', ${userId}::text),
           ${userId}::text
      FROM generate_series(1, ${count}) AS gs(n);
  `);
  // v2..depth updates
  for (let v = 2; v <= depth; v++) {
    await testDb.db.execute(sql`
      INSERT INTO events (aggregate_id, aggregate_type, tenant_id, version, type, payload, metadata, created_by)
      SELECT e.aggregate_id, 'task', ${admin.tenantId}::uuid, ${v}, 'task.updated',
             jsonb_build_object('title', 'Task v' || ${v}),
             jsonb_build_object('userId', ${userId}::text),
             ${userId}::text
        FROM events e
       WHERE e.aggregate_type = 'task' AND e.version = ${v - 1};
    `);
  }
}

describe("rebuildProjection performance — Gate A", () => {
  test("rebuild rate >= 5k events/sec under suite-parallel-load (10000 events)", async () => {
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

    expect(rate).toBeGreaterThanOrEqual(5_000);
  });
});
