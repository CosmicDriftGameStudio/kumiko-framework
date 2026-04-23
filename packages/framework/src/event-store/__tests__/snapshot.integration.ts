// Sprint E.3 — Snapshot store.
//
// Pins three invariants for the framework-internal snapshot surface:
//   1. saveSnapshot + loadLatestSnapshot round-trip a state.
//   2. loadAggregateWithSnapshot(snapshot + deltas) yields the same final
//      state as loadAggregate + full-replay — snapshots stay truthful to
//      the event log they compress.
//   3. Performance — a 1000-event aggregate with a snapshot at v900 loads
//      in < 50ms (typical asOf/reducer rehydrate budget). Same gate the
//      spike proved on raw SQL, now enforced on the framework path.

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { TenantId } from "../../engine/types";
import { createTestDb, type TestDb } from "../../testing";
import { generateId as uuid } from "../../utils";
import {
  append,
  archiveStream,
  createEventsTable,
  loadAggregate,
  loadAggregateWithSnapshot,
  loadLatestSnapshot,
  type SnapshotReducer,
  saveSnapshot,
} from "../index";

let testDb: TestDb;
const tenant = uuid() as TenantId;
const userId = uuid();

type CounterState = Record<string, unknown> & {
  readonly count: number;
  readonly label: string;
};

const initial: CounterState = { count: 0, label: "init" };

// Tiny reducer: count.incremented → count++, label.set → overwrite label.
const reducer: SnapshotReducer<CounterState> = (state, event) => {
  if (event.type === "counter.incremented") {
    const by = (event.payload["by"] as number | undefined) ?? 1;
    return { ...state, count: state.count + by };
  }
  if (event.type === "counter.label-set") {
    return { ...state, label: event.payload["label"] as string };
  }
  return state;
};

beforeAll(async () => {
  testDb = await createTestDb();
  await createEventsTable(testDb.db);
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await testDb.db.execute(
    sql`TRUNCATE events, kumiko_snapshots, kumiko_archived_streams RESTART IDENTITY`,
  );
});

// Append N increment events to a fresh aggregate. Returns the aggregate id.
async function seedAggregate(eventCount: number): Promise<string> {
  const aggId = uuid();
  for (let i = 0; i < eventCount; i++) {
    await append(testDb.db, {
      aggregateId: aggId,
      aggregateType: "counter",
      tenantId: tenant,
      expectedVersion: i,
      type: "counter.incremented",
      payload: { by: 1 },
      metadata: { userId },
    });
  }
  return aggId;
}

// Reduce by loading every event through the framework's loadAggregate —
// the ground truth the snapshot path must match. Using the real API (not
// raw SQL) keeps the invariant honest: if loadAggregate semantics drift,
// this helper shifts with them.
async function loadFullState(aggregateId: string): Promise<CounterState> {
  const events = await loadAggregate(testDb.db, aggregateId, tenant);
  let state: CounterState = initial;
  for (const event of events) {
    state = reducer(state, event);
  }
  return state;
}

describe("snapshot-store — round-trip", () => {
  test("saveSnapshot + loadLatestSnapshot roundtrip the state", async () => {
    const aggId = uuid();
    await saveSnapshot(testDb.db, {
      aggregateId: aggId,
      tenantId: tenant,
      aggregateType: "counter",
      version: 42,
      state: { count: 100, label: "checkpoint" },
    });

    const loaded = await loadLatestSnapshot<CounterState>(testDb.db, aggId, tenant);
    expect(loaded).not.toBeNull();
    expect(loaded?.version).toBe(42);
    expect(loaded?.state).toEqual({ count: 100, label: "checkpoint" });
    expect(loaded?.aggregateType).toBe("counter");
  });

  test("saveSnapshot is idempotent — re-snapshotting the same version upserts", async () => {
    const aggId = uuid();
    await saveSnapshot(testDb.db, {
      aggregateId: aggId,
      tenantId: tenant,
      aggregateType: "counter",
      version: 10,
      state: { count: 10, label: "v1" },
    });
    await saveSnapshot(testDb.db, {
      aggregateId: aggId,
      tenantId: tenant,
      aggregateType: "counter",
      version: 10,
      state: { count: 10, label: "v2-updated" },
    });
    const loaded = await loadLatestSnapshot<CounterState>(testDb.db, aggId, tenant);
    expect(loaded?.state.label).toBe("v2-updated");
  });

  test("loadLatestSnapshot picks the highest version when multiple exist", async () => {
    const aggId = uuid();
    for (const v of [5, 50, 20, 100, 75]) {
      await saveSnapshot(testDb.db, {
        aggregateId: aggId,
        tenantId: tenant,
        aggregateType: "counter",
        version: v,
        state: { count: v * 2, label: `at-${v}` },
      });
    }
    const loaded = await loadLatestSnapshot<CounterState>(testDb.db, aggId, tenant);
    expect(loaded?.version).toBe(100);
    expect(loaded?.state.label).toBe("at-100");
  });
});

describe("snapshot-store — loadAggregateWithSnapshot", () => {
  test("snapshot + delta replay equals full replay", async () => {
    const aggId = await seedAggregate(50);
    // Seeded aggregate has 50 increment events — state at v40 is count=40.
    // Snapshot MUST reflect that truth; otherwise the "snapshot + deltas =
    // full replay" invariant is meaningless.
    const partial = { count: 40, label: "snap-at-40" };
    await saveSnapshot(testDb.db, {
      aggregateId: aggId,
      tenantId: tenant,
      aggregateType: "counter",
      version: 40,
      state: partial,
    });

    const full = await loadFullState(aggId);
    const snapBased = await loadAggregateWithSnapshot<CounterState>(
      testDb.db,
      aggId,
      tenant,
      reducer,
      initial,
    );
    expect(snapBased.snapshotHit).toBe(true);
    expect(snapBased.version).toBe(50);
    expect(snapBased.state.count).toBe(full.count);
    expect(snapBased.state.count).toBe(50);
  });

  test("no snapshot → falls back to full replay (snapshotHit=false)", async () => {
    const aggId = await seedAggregate(20);
    const full = await loadFullState(aggId);
    const snapBased = await loadAggregateWithSnapshot<CounterState>(
      testDb.db,
      aggId,
      tenant,
      reducer,
      initial,
    );
    expect(snapBased.snapshotHit).toBe(false);
    expect(snapBased.version).toBe(20);
    expect(snapBased.state.count).toBe(full.count);
  });

  test("archived stream returns initial + snapshotHit=false (matches loadAggregate)", async () => {
    // Archive semantics must be symmetric with loadAggregate — an archived
    // stream is "gone" from the default read path, regardless of snapshot
    // presence. Otherwise a snapshot would silently survive a GDPR-style
    // archival and leak state that the event log hid.
    const aggId = await seedAggregate(10);
    await saveSnapshot(testDb.db, {
      aggregateId: aggId,
      tenantId: tenant,
      aggregateType: "counter",
      version: 10,
      state: { count: 10, label: "pre-archive" },
    });
    await archiveStream(testDb.db, {
      tenantId: tenant,
      aggregateId: aggId,
      aggregateType: "counter",
      archivedBy: userId,
    });

    const snapBased = await loadAggregateWithSnapshot<CounterState>(
      testDb.db,
      aggId,
      tenant,
      reducer,
      initial,
    );
    expect(snapBased.state).toEqual(initial);
    expect(snapBased.version).toBe(0);
    expect(snapBased.snapshotHit).toBe(false);

    // includeArchived opt-in surfaces the snapshot + deltas for ops tooling.
    const archived = await loadAggregateWithSnapshot<CounterState>(
      testDb.db,
      aggId,
      tenant,
      reducer,
      initial,
      { includeArchived: true },
    );
    expect(archived.snapshotHit).toBe(true);
    expect(archived.state.count).toBe(10);
  });

  test("1000-event aggregate with snapshot at v900 loads in under 50ms", async () => {
    const aggId = await seedAggregate(1000);
    await saveSnapshot(testDb.db, {
      aggregateId: aggId,
      tenantId: tenant,
      aggregateType: "counter",
      version: 900,
      state: { count: 900, label: "snap-at-900" },
    });

    // Warm cache
    await loadAggregateWithSnapshot<CounterState>(testDb.db, aggId, tenant, reducer, initial);

    const start = performance.now();
    const snapBased = await loadAggregateWithSnapshot<CounterState>(
      testDb.db,
      aggId,
      tenant,
      reducer,
      initial,
    );
    const elapsedMs = performance.now() - start;

    expect(snapBased.snapshotHit).toBe(true);
    expect(snapBased.version).toBe(1000);
    expect(snapBased.state.count).toBe(1000);
    expect(elapsedMs).toBeLessThan(50);
  });
});
