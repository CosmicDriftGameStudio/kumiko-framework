// Event-Store Performance — Gate A targets from the Sprint-B spike.
// Asserts that today's framework API holds the same latency envelope as
// the raw-SQL spike used as proof before the ES pivot.
//
// Targets (from docs/plans/architecture/event-sourcing-spike-1.md):
//   - Write-Latency  p95 < 30ms  (append a single event)
//   - Read-Latency   p95 < 25ms  (loadAggregate for a single aggregate)
//   - Update-Latency p95 < 30ms  (append with predecessor-check WHERE EXISTS)
//   - Snapshot-Load < 50ms       (1000-event aggregate, snapshot @ 900)
//
// Workload is sequential against local Docker Postgres — no network
// latency, single-node PG. Production deploys are slower; these numbers
// are the ceiling.
//
// Isolated from bulk integration via `bun run test:integration:perf`. Used
// to run inside the `integration` CI job, right after the ~213-test bulk
// suite, and flaked up to 3.4x under that (30-102ms vs the 25-30ms budgets
// above, #1940). Moved to its own `event-store-perf` CI job
// (test:integration:perf:eventstore) — but re-measuring against a fresh
// container per run (mirroring that job) showed the real cause wasn't job
// contention: p50 sits at 1-3ms in every run, and single-sample p99 spikes
// to 47-73ms even fully isolated on an idle machine, from cold-Postgres
// connection/cache warm-up. Gate switched from p99 (the single worst-of-200
// sample) to p95 (drops the top 10), which absorbs that cold-start outlier
// while still catching a real order-of-magnitude regression.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { type BunTestDb, createTestDb } from "../../bun-db/__tests__/bun-test-db";
import { asRawClient } from "../../db/query";
import type { TenantId } from "../../engine/types";
import { ensureTemporalPolyfill } from "../../time/polyfill";
import { generateId as uuid } from "../../utils";
import {
  append,
  createEventsTable,
  loadAggregate,
  loadAggregateWithSnapshot,
  saveSnapshot,
} from "../index";

let testDb: BunTestDb;
const tenantId = uuid() as TenantId;
const userId = uuid();

beforeAll(async () => {
  await ensureTemporalPolyfill();
  testDb = await createTestDb();
  await createEventsTable(testDb.db);
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await asRawClient(testDb.db).unsafe(
    `TRUNCATE kumiko_events, kumiko_snapshots, kumiko_archived_streams RESTART IDENTITY CASCADE`,
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
  test("write-latency p95 < 30ms over 200 sequential appends", async () => {
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
    const p95 = percentile(samples, 0.95);
    const p99 = percentile(samples, 0.99);
    console.log(
      `  Write-latency: p50=${p50.toFixed(2)}ms, p95=${p95.toFixed(2)}ms, p99=${p99.toFixed(2)}ms (n=200)`,
    );

    expect(p95).toBeLessThan(30);
  });

  test("read-latency p95 < 25ms for loadAggregate detail reads", async () => {
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
    const p95 = percentile(samples, 0.95);
    const p99 = percentile(samples, 0.99);
    console.log(
      `  Read-latency:  p50=${p50.toFixed(2)}ms, p95=${p95.toFixed(2)}ms, p99=${p99.toFixed(2)}ms (n=${ids.length})`,
    );

    // 25ms budget kept from the original spike doc's 10ms — an
    // order-of-magnitude gate, not an idle-best-case one. Tracking: #325.
    expect(p95).toBeLessThan(25);
  });

  test("update-latency p95 < 30ms — exercises predecessor-check WHERE EXISTS path", async () => {
    // Single aggregate, repeated updates — the INSERT … SELECT … WHERE EXISTS
    // path is heavier than a simple create and adds an index lookup.
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
    const p95 = percentile(samples, 0.95);
    const p99 = percentile(samples, 0.99);
    console.log(
      `  Update-latency: p50=${p50.toFixed(2)}ms, p95=${p95.toFixed(2)}ms, p99=${p99.toFixed(2)}ms (n=200)`,
    );

    expect(p95).toBeLessThan(30);
  });

  test("snapshot-load < 50ms for 1000-event aggregate (Gate A)", async () => {
    // Bulk-seed 1000 events via direct SQL insert — 1000 sequential
    // append() calls would take minutes. We measure the
    // loadAggregateWithSnapshot performance on a finished stream, not
    // the seed phase.
    const aggregateId = uuid();
    await asRawClient(testDb.db).unsafe(
      `
      INSERT INTO kumiko_events (aggregate_id, aggregate_type, tenant_id, version, type, payload, metadata, created_by)
      SELECT $1::uuid, 'task', $2::uuid, 1, 'task.created',
             jsonb_build_object('title', 'v1'),
             jsonb_build_object('userId', $3::text),
             $4::text;
    `,
      [aggregateId, tenantId, userId, userId],
    );
    await asRawClient(testDb.db).unsafe(
      `
      INSERT INTO kumiko_events (aggregate_id, aggregate_type, tenant_id, version, type, payload, metadata, created_by)
      SELECT $1::uuid, 'task', $2::uuid, gs.v, 'task.updated',
             jsonb_build_object('title', 'v' || gs.v),
             jsonb_build_object('userId', $3::text),
             $4::text
        FROM generate_series(2, 1000) gs(v);
    `,
      [aggregateId, tenantId, userId, userId],
    );

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

    const samples: number[] = [];
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      const result = await loadAggregateWithSnapshot<TaskState>(
        testDb.db,
        aggregateId,
        tenantId,
        reducer,
        { title: "", version: 0 },
      );
      samples.push(performance.now() - start);
      expect(result.snapshotHit).toBe(true);
      expect(result.version).toBe(1000);
      expect(result.state.title).toBe("v1000");
    }

    samples.sort((a, b) => a - b);
    const medianMs = samples[Math.floor(samples.length / 2)] ?? 0;
    const p95Ms = samples[Math.floor(samples.length * 0.95)] ?? medianMs;
    console.log(
      `  Snapshot-load (1000-event aggregate, 100 delta events): median=${medianMs.toFixed(1)}ms p95=${p95Ms.toFixed(1)}ms`,
    );

    expect(medianMs).toBeLessThan(50);
  });
});
