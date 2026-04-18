// Event-Store Performance — Gate A targets aus dem Sprint-B-Spike.
// Hier validieren wir dass die heutige Framework-API die gleichen
// Performance-Niveaus hält wie der raw-SQL-Spike, der vor dem ES-Pivot
// als Beweis benutzt wurde.
//
// Targets (aus docs/plans/architecture/event-sourcing-spike-1.md):
//   - Write-Latency  p99 < 30ms  (append einer einzelnen event)
//   - Read-Latency   p99 < 10ms  (loadAggregate für Single-Aggregate)
//   - Update-Latency p99 < 30ms  (append mit predecessor-check WHERE EXISTS)
//   - Snapshot-Load < 50ms       (1000-event aggregate, snapshot @ 900)
//
// Workload ist sequenziell gegen lokales Docker-Postgres — keine Netzwerk-
// Latenz, single-node PG. Production-deploys sind langsamer; diese Zahlen
// sind die Decke. Bei rotem Test: Framework-Regression, KEIN OK-Toleranz.

import { sql } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { TenantId } from "../../engine/types";
import { createTestDb, type TestDb } from "../../testing";
import {
  append,
  createEventsTable,
  loadAggregate,
  loadAggregateWithSnapshot,
  saveSnapshot,
} from "../index";

let testDb: TestDb;
const tenantId = uuid() as TenantId;
const userId = uuid();

beforeAll(async () => {
  testDb = await createTestDb();
  await createEventsTable(testDb.db);
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await testDb.db.execute(
    sql`TRUNCATE events, kumiko_snapshots, kumiko_archived_streams RESTART IDENTITY CASCADE`,
  );
});

function percentile(sorted: readonly number[], p: number): number {
  const idx = Math.ceil(sorted.length * p) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))] ?? 0;
}

async function measure<T>(op: () => Promise<T>): Promise<number> {
  const start = performance.now();
  await op();
  return performance.now() - start;
}

describe("event-store performance — Gate A", () => {
  test("write-latency p99 < 30ms over 200 sequential appends", async () => {
    const samples: number[] = [];

    // Warm-up — Connection-Pool + Drizzle-Prepare-Overhead
    for (let i = 0; i < 10; i++) {
      await append(testDb.db, {
        aggregateId: uuid(),
        aggregateType: "task",
        tenantId,
        expectedVersion: 0,
        type: "task.created",
        payload: { title: `warm ${i}` },
        metadata: { userId },
      });
    }

    for (let i = 0; i < 200; i++) {
      const aggregateId = uuid();
      samples.push(
        await measure(() =>
          append(testDb.db, {
            aggregateId,
            aggregateType: "task",
            tenantId,
            expectedVersion: 0,
            type: "task.created",
            payload: { title: `sample ${i}` },
            metadata: { userId },
          }),
        ),
      );
    }

    samples.sort((a, b) => a - b);
    const p50 = percentile(samples, 0.5);
    const p99 = percentile(samples, 0.99);
    console.log(`  Write-latency: p50=${p50.toFixed(2)}ms, p99=${p99.toFixed(2)}ms (n=200)`);

    expect(p99).toBeLessThan(30);
  });

  test("read-latency p99 < 10ms for loadAggregate detail reads", async () => {
    // Seed 200 single-event aggregates
    const ids: string[] = [];
    for (let i = 0; i < 200; i++) {
      const aggregateId = uuid();
      await append(testDb.db, {
        aggregateId,
        aggregateType: "task",
        tenantId,
        expectedVersion: 0,
        type: "task.created",
        payload: { title: `read ${i}` },
        metadata: { userId },
      });
      ids.push(aggregateId);
    }

    // Warm-up
    for (const id of ids.slice(0, 10)) {
      await loadAggregate(testDb.db, id, tenantId);
    }

    const samples: number[] = [];
    for (const id of ids) {
      samples.push(await measure(() => loadAggregate(testDb.db, id, tenantId)));
    }

    samples.sort((a, b) => a - b);
    const p50 = percentile(samples, 0.5);
    const p99 = percentile(samples, 0.99);
    console.log(
      `  Read-latency:  p50=${p50.toFixed(2)}ms, p99=${p99.toFixed(2)}ms (n=${ids.length})`,
    );

    expect(p99).toBeLessThan(10);
  });

  test("update-latency p99 < 30ms — exercises predecessor-check WHERE EXISTS path", async () => {
    // Single aggregate, repeated updates — der INSERT … SELECT … WHERE EXISTS
    // Pfad ist komplexer als ein simple create und braucht extra Index-Lookup.
    const aggregateId = uuid();
    await append(testDb.db, {
      aggregateId,
      aggregateType: "task",
      tenantId,
      expectedVersion: 0,
      type: "task.created",
      payload: { title: "target" },
      metadata: { userId },
    });
    let version = 1;

    // Warm-up
    for (let i = 0; i < 10; i++) {
      await append(testDb.db, {
        aggregateId,
        aggregateType: "task",
        tenantId,
        expectedVersion: version,
        type: "task.updated",
        payload: { title: `warm ${i}` },
        metadata: { userId },
      });
      version++;
    }

    const samples: number[] = [];
    for (let i = 0; i < 200; i++) {
      const current = version;
      samples.push(
        await measure(() =>
          append(testDb.db, {
            aggregateId,
            aggregateType: "task",
            tenantId,
            expectedVersion: current,
            type: "task.updated",
            payload: { title: `sample ${i}` },
            metadata: { userId },
          }),
        ),
      );
      version++;
    }

    samples.sort((a, b) => a - b);
    const p50 = percentile(samples, 0.5);
    const p99 = percentile(samples, 0.99);
    console.log(`  Update-latency: p50=${p50.toFixed(2)}ms, p99=${p99.toFixed(2)}ms (n=200)`);

    expect(p99).toBeLessThan(30);
  });

  test("snapshot-load < 50ms for 1000-event aggregate (Gate A)", async () => {
    // Bulk-seed 1000 events — direkter SQL-Insert weil 1000 sequentielle
    // append()-Calls würden den Test minutenlang machen. Was wir messen
    // ist die loadAggregateWithSnapshot-Performance auf dem fertigen Stream,
    // nicht den Build-Vorgang.
    const aggregateId = uuid();
    await testDb.db.execute(sql`
      INSERT INTO events (aggregate_id, aggregate_type, tenant_id, version, type, payload, metadata, created_by)
      SELECT ${aggregateId}::uuid, 'task', ${tenantId}::uuid, 1, 'task.created',
             jsonb_build_object('title', 'v1'),
             jsonb_build_object('userId', ${userId}::text),
             ${userId}::text;
    `);
    await testDb.db.execute(sql`
      INSERT INTO events (aggregate_id, aggregate_type, tenant_id, version, type, payload, metadata, created_by)
      SELECT ${aggregateId}::uuid, 'task', ${tenantId}::uuid, gs.v, 'task.updated',
             jsonb_build_object('title', 'v' || gs.v),
             jsonb_build_object('userId', ${userId}::text),
             ${userId}::text
        FROM generate_series(2, 1000) gs(v);
    `);

    // Snapshot @ version 900 — typische Policy: snapshot every N events
    await saveSnapshot(testDb.db, {
      aggregateId,
      tenantId,
      aggregateType: "task",
      version: 900,
      state: { title: "v900", version: 900 },
    });

    type TaskState = { title: string; version: number };
    const reducer = (state: TaskState, evt: { payload: Record<string, unknown> }): TaskState => ({
      ...state,
      title: (evt.payload["title"] as string) ?? state.title,
    });

    // Warm-up
    await loadAggregateWithSnapshot<TaskState>(testDb.db, aggregateId, tenantId, reducer, {
      title: "",
      version: 0,
    });

    const start = performance.now();
    const result = await loadAggregateWithSnapshot<TaskState>(
      testDb.db,
      aggregateId,
      tenantId,
      reducer,
      { title: "", version: 0 },
    );
    const durationMs = performance.now() - start;

    expect(result.snapshotHit).toBe(true);
    expect(result.version).toBe(1000);
    expect(result.state.title).toBe("v1000");
    console.log(
      `  Snapshot-load (1000-event aggregate, 100 delta events): ${durationMs.toFixed(1)}ms`,
    );

    expect(durationMs).toBeLessThan(50);
  });
});
