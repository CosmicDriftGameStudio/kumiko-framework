// Admin-API integration tests — appendRaw + appendRawBatch.
//
// Contract (Prod-Readiness Welle 3, Step 3.1):
//   - Pipeline-Bypass: no pg_notify, no projection, no SSE/Search/Audit.
//   - Historical timestamps preserved: createdAt + createdBy flow through
//     from caller parameter to DB row unchanged.
//   - Version-check kept: UNIQUE (tenant_id, aggregate_id, version) catches
//     duplicates; predecessor-EXISTS for expectedVersion > 0 catches gaps.
//   - Batch: single INSERT with multi-VALUES; atomic rollback on any
//     failure; predecessor pre-flight per aggregate in the batch.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient, selectMany } from "../../db/query";
import type { DbConnection } from "../../db/connection";
import { createTestDb, type TestDb } from "../../stack";
import { generateId as uuid } from "../../utils";
import { appendRaw, appendRawBatch, type RawEventToAppend } from "../admin-api";
import { VersionConflictError } from "../errors";
import { append, loadAggregate } from "../event-store";
import { eventsTable } from "../events-schema";
import { createEventsTable } from "../events-schema";

// Test-only spy: wrap a DbConnection's `.unsafe()` to capture the SQL
// string of every query the framework runs. Used to assert batching
// behaviour (single multi-VALUES INSERT vs N statements).
function spyQueries(db: DbConnection): { db: DbConnection; queries: string[] } {
  const queries: string[] = [];
  const wrapped = new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "unsafe") {
        return (sql: string, params?: readonly unknown[]) => {
          queries.push(sql);
          // biome-ignore lint/suspicious/noExplicitAny: postgres-js .unsafe signature variance
          return (target as any).unsafe(sql, params);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  return { db: wrapped, queries };
}

let testDb: TestDb;

const tenantA = uuid();
const userMigration = "migration-importer";
const legacyUser = "legacy-user-42";

beforeAll(async () => {
  testDb = await createTestDb();
  await createEventsTable(testDb.db);
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await asRawClient(testDb.db).unsafe(`TRUNCATE kumiko_events RESTART IDENTITY`);
});

function makeEvent(partial: Partial<RawEventToAppend> = {}): RawEventToAppend {
  return {
    aggregateId: partial.aggregateId ?? uuid(),
    aggregateType: partial.aggregateType ?? "legacy-order",
    tenantId: partial.tenantId ?? tenantA,
    expectedVersion: partial.expectedVersion ?? 0,
    type: partial.type ?? "legacy.order.created",
    payload: partial.payload ?? { legacyId: 100 },
    metadata: partial.metadata ?? { userId: userMigration, requestId: "import-batch-1" },
    createdAt: partial.createdAt ?? Temporal.Instant.from("2023-01-15T10:00:00Z"),
    createdBy: partial.createdBy ?? legacyUser,
    eventVersion: partial.eventVersion,
  };
}

describe("appendRaw — single event", () => {
  test("preserves historical createdAt (NOT now())", async () => {
    // Sub-second precision matters for migration: Legacy events with
    // distinct millisecond timestamps must keep their exact ordering.
    // Comparing via Temporal.Instant (not Date → isoString) preserves
    // the full precision the `instant()` column round-trips.
    const historicTs = Temporal.Instant.from("2021-06-03T14:22:10.123Z");
    const aggregateId = uuid();

    await appendRaw(testDb.db, makeEvent({ aggregateId, createdAt: historicTs }));

    // loadAggregate uses the typed-builder path → createdAt already comes
    // back as Temporal.Instant. Compare via epochMilliseconds for an exact
    // moment-level match (no Date-roundtrip precision loss).
    const [stored] = await loadAggregate(testDb.db, aggregateId, tenantA);
    expect(stored).toBeDefined();
    expect(stored!.createdAt.epochMilliseconds).toBe(historicTs.epochMilliseconds);
  });

  test("preserves historical createdBy (NOT metadata.userId)", async () => {
    const aggregateId = uuid();
    // Migration-runner's own id lives in metadata.userId; the legacy actor
    // lives in createdBy. These are DIFFERENT for an import — the raw-path
    // must NOT conflate them.
    await appendRaw(
      testDb.db,
      makeEvent({
        aggregateId,
        createdBy: legacyUser,
        metadata: { userId: userMigration, requestId: "import-batch-1" },
      }),
    );

    const rows = await asRawClient(testDb.db).unsafe<{ created_by: string }>(
      `
      SELECT created_by FROM kumiko_events WHERE aggregate_id = $1::uuid
    `,
      [aggregateId],
    );
    expect(rows[0]?.created_by).toBe(legacyUser);
    expect(rows[0]?.created_by).not.toBe(userMigration);
  });

  test("events written via appendRaw are structurally identical to append — full payload/metadata round-trip", async () => {
    const aggregateId = uuid();
    const payload = { legacyId: 7, state: "Accepted", nested: { amount: "12.50" } };
    const metadata = {
      userId: userMigration,
      requestId: "import-batch-2",
      correlationId: "legacy-order-7",
      headers: { source: "beammycar-prod-dump" },
    };

    await appendRaw(
      testDb.db,
      makeEvent({
        aggregateId,
        type: "legacy.order.accepted",
        payload,
        metadata,
      }),
    );

    const rows = await selectMany(testDb.db, eventsTable, { aggregateId });
    expect(rows[0]?.payload).toEqual(payload);
    expect(rows[0]?.metadata).toEqual(metadata);
  });

  test("does NOT fire pg_notify on EVENTS_PUBSUB_CHANNEL — contrast with append", async () => {
    // Open a dedicated LISTEN connection. postgres-js exposes listen() on the
    // client; the callback is invoked per NOTIFY payload. The resolved value
    // is a meta-object with an `unlisten` method, not a plain function.
    const notifications: string[] = [];
    const subscription = await testDb.client.listen("kumiko_events_new", (payload) => {
      notifications.push(payload);
    });

    try {
      // appendRaw path — MUST NOT fire.
      await appendRaw(testDb.db, makeEvent());
      // Give the event-loop a moment; LISTEN delivery is async but within
      // the same tick usually.
      await new Promise((r) => setTimeout(r, 50));
      expect(notifications).toHaveLength(0);

      // Control: regular append() DOES fire. Same test-DB, same LISTEN.
      await append(testDb.db, {
        aggregateId: uuid(),
        aggregateType: "control",
        tenantId: tenantA,
        expectedVersion: 0,
        type: "control.created",
        payload: {},
        metadata: { userId: userMigration },
      });
      await new Promise((r) => setTimeout(r, 50));
      expect(notifications.length).toBeGreaterThan(0);
    } finally {
      await subscription.unlisten();
    }
  });

  test("version_conflict on duplicate (aggregateId, expectedVersion)", async () => {
    const aggregateId = uuid();
    await appendRaw(testDb.db, makeEvent({ aggregateId, expectedVersion: 0 }));

    await expect(
      appendRaw(testDb.db, makeEvent({ aggregateId, expectedVersion: 0 })),
    ).rejects.toBeInstanceOf(VersionConflictError);
  });

  test("version_conflict on missing predecessor (appendRaw v=5 without v=1..4)", async () => {
    const aggregateId = uuid();
    // Try to write version=5 (expectedVersion=4) against an empty stream.
    // Predecessor check must catch this — otherwise orphaned events would
    // land in the DB.
    await expect(
      appendRaw(testDb.db, makeEvent({ aggregateId, expectedVersion: 4 })),
    ).rejects.toBeInstanceOf(VersionConflictError);

    // Sanity: no row landed.
    const rows = await asRawClient(testDb.db).unsafe<{ c: number }>(
      `
      SELECT count(*)::int as c FROM kumiko_events WHERE aggregate_id = $1::uuid
    `,
      [aggregateId],
    );
    expect(rows[0]?.c).toBe(0);
  });

  test("appendRaw writes version = expectedVersion + 1 — matches append semantics", async () => {
    const aggregateId = uuid();
    await appendRaw(testDb.db, makeEvent({ aggregateId, expectedVersion: 0 }));
    await appendRaw(testDb.db, makeEvent({ aggregateId, expectedVersion: 1 }));
    await appendRaw(testDb.db, makeEvent({ aggregateId, expectedVersion: 2 }));

    const rows = await asRawClient(testDb.db).unsafe<{ version: number }>(
      `
      SELECT version FROM kumiko_events WHERE aggregate_id = $1::uuid ORDER BY version
    `,
      [aggregateId],
    );
    expect(rows.map((r) => r.version)).toEqual([1, 2, 3]);
  });
});

describe("appendRawBatch — multi-event", () => {
  test("writes all events in a single INSERT statement (query-log spy)", async () => {
    const { db: loggedDb, queries } = spyQueries(testDb.db);

    const aggregateId = uuid();
    const events: readonly RawEventToAppend[] = [
      makeEvent({ aggregateId, expectedVersion: 0, type: "legacy.order.created" }),
      makeEvent({ aggregateId, expectedVersion: 1, type: "legacy.order.accepted" }),
      makeEvent({ aggregateId, expectedVersion: 2, type: "legacy.order.canceled" }),
    ];

    await appendRawBatch(loggedDb, events);

    const inserts = queries.filter((q) => /insert\s+into\s+"?kumiko_events"?/i.test(q));
    expect(inserts).toHaveLength(1);

    // All three events persisted with ascending versions.
    const rows = await asRawClient(testDb.db).unsafe<{ version: number; type: string }>(
      `
      SELECT version, type FROM kumiko_events WHERE aggregate_id = $1::uuid ORDER BY version
    `,
      [aggregateId],
    );
    expect(rows.map((r) => ({ v: r.version, t: r.type }))).toEqual([
      { v: 1, t: "legacy.order.created" },
      { v: 2, t: "legacy.order.accepted" },
      { v: 3, t: "legacy.order.canceled" },
    ]);
  });

  test("preserves per-event historical createdAt across the batch", async () => {
    // Three distinct sub-second timestamps: verifies the batch INSERT path
    // doesn't collapse them to now() or to a single batch-timestamp.
    const aggregateId = uuid();
    const t1 = Temporal.Instant.from("2020-03-01T08:00:00.111Z");
    const t2 = Temporal.Instant.from("2020-03-02T09:30:00.222Z");
    const t3 = Temporal.Instant.from("2020-03-05T12:15:45.333Z");

    await appendRawBatch(testDb.db, [
      makeEvent({ aggregateId, expectedVersion: 0, createdAt: t1 }),
      makeEvent({ aggregateId, expectedVersion: 1, createdAt: t2 }),
      makeEvent({ aggregateId, expectedVersion: 2, createdAt: t3 }),
    ]);

    const stored = await loadAggregate(testDb.db, aggregateId, tenantA);
    expect(stored.map((s) => s.createdAt.epochMilliseconds)).toEqual([
      t1.epochMilliseconds,
      t2.epochMilliseconds,
      t3.epochMilliseconds,
    ]);
  });

  test("atomic rollback: if ANY event in the batch conflicts, NO events land in the DB", async () => {
    const aggregateId = uuid();
    // Seed version 1 so the batch's first event collides.
    await appendRaw(testDb.db, makeEvent({ aggregateId, expectedVersion: 0 }));

    const batch: readonly RawEventToAppend[] = [
      makeEvent({ aggregateId, expectedVersion: 0 }), // DUPLICATE — will fail
      makeEvent({ aggregateId: uuid(), expectedVersion: 0 }), // valid
      makeEvent({ aggregateId: uuid(), expectedVersion: 0 }), // valid
    ];

    await expect(appendRawBatch(testDb.db, batch)).rejects.toBeInstanceOf(VersionConflictError);

    // Only the seed event survived — multi-VALUES INSERT is atomic.
    const rows = await asRawClient(testDb.db).unsafe<{ c: number }>(`
      SELECT count(*)::int as c FROM kumiko_events
    `);
    expect(rows[0]?.c).toBe(1);
  });

  test("version_conflict when first-in-aggregate event has missing predecessor", async () => {
    // Batch tries to write v=5..6 for an empty stream. Pre-flight predecessor
    // check per aggregate-group catches the gap before the INSERT runs.
    const aggregateId = uuid();
    await expect(
      appendRawBatch(testDb.db, [
        makeEvent({ aggregateId, expectedVersion: 4 }),
        makeEvent({ aggregateId, expectedVersion: 5 }),
      ]),
    ).rejects.toBeInstanceOf(VersionConflictError);

    const rows = await asRawClient(testDb.db).unsafe<{ c: number }>(
      `
      SELECT count(*)::int as c FROM kumiko_events WHERE aggregate_id = $1::uuid
    `,
      [aggregateId],
    );
    expect(rows[0]?.c).toBe(0);
  });

  test("version_conflict on gap within a single-aggregate batch (defense-in-depth against buggy mapper)", async () => {
    // Mapper bug scenario: produces events [v=1, v=3] for the same aggregate
    // (expectedVersions [0, 2] — v=2 missing). Without the contiguity check,
    // UNIQUE wouldn't catch the gap (no collision), predecessor-EXISTS
    // wouldn't catch it (min expectedVersion is 0, check skipped), and v=2
    // would silently be orphaned. Must fail loud at batch-entry.
    const aggregateId = uuid();
    await expect(
      appendRawBatch(testDb.db, [
        makeEvent({ aggregateId, expectedVersion: 0 }),
        makeEvent({ aggregateId, expectedVersion: 2 }),
      ]),
    ).rejects.toBeInstanceOf(VersionConflictError);

    // Zero events persisted — the whole batch is rejected before the INSERT.
    const rows = await asRawClient(testDb.db).unsafe<{ c: number }>(
      `
      SELECT count(*)::int as c FROM kumiko_events WHERE aggregate_id = $1::uuid
    `,
      [aggregateId],
    );
    expect(rows[0]?.c).toBe(0);
  });

  test("contiguity check is per-aggregate — independent aggregates with non-overlapping versions pass", async () => {
    // Two different aggregates. agg1 at [v=1,2], agg2 at [v=1]. The contiguity
    // check groups by aggregate_id, so agg1's [0→1, 1→2] and agg2's [0→1] are
    // checked independently — no spurious cross-aggregate gap false-positive.
    const agg1 = uuid();
    const agg2 = uuid();
    await appendRawBatch(testDb.db, [
      makeEvent({ aggregateId: agg1, expectedVersion: 0 }),
      makeEvent({ aggregateId: agg2, expectedVersion: 0 }),
      makeEvent({ aggregateId: agg1, expectedVersion: 1 }),
    ]);

    const s1 = await loadAggregate(testDb.db, agg1, tenantA);
    const s2 = await loadAggregate(testDb.db, agg2, tenantA);
    expect(s1.map((e) => e.version)).toEqual([1, 2]);
    expect(s2.map((e) => e.version)).toEqual([1]);
  });

  test("empty array is a no-op — no query, no throw", async () => {
    const { db: loggedDb, queries } = spyQueries(testDb.db);

    await appendRawBatch(loggedDb, []);
    expect(queries).toHaveLength(0);
  });

  test("multi-aggregate batch: each aggregate lands on its own stream with the right type", async () => {
    // Mixed batch: two DIFFERENT aggregates, v=0 each. Single INSERT, both
    // land, each on its own stream with the event type that was paired with
    // it at call-time (no cross-talk between rows in the multi-VALUES list).
    const agg1 = uuid();
    const agg2 = uuid();
    await appendRawBatch(testDb.db, [
      makeEvent({ aggregateId: agg1, expectedVersion: 0, type: "legacy.order.created" }),
      makeEvent({ aggregateId: agg2, expectedVersion: 0, type: "legacy.driver.created" }),
    ]);

    const stream1 = await loadAggregate(testDb.db, agg1, tenantA);
    const stream2 = await loadAggregate(testDb.db, agg2, tenantA);

    expect(stream1.map((s) => ({ v: s.version, t: s.type }))).toEqual([
      { v: 1, t: "legacy.order.created" },
    ]);
    expect(stream2.map((s) => ({ v: s.version, t: s.type }))).toEqual([
      { v: 1, t: "legacy.driver.created" },
    ]);
  });
});
