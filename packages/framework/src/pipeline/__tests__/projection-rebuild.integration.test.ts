// Projection rebuild — the load-bearing claim of the whole projections API.
// "Projections are rebuildable read-models" has to actually work: replaying
// the event log must produce the exact same state as live apply().
//
// Tests here:
//   - rebuild from empty state matches live-applied state
//   - rebuild after data-corruption fixes the projection
//   - rebuild preserves atomicity (throw mid-replay → status=failed + old
//     rows intact)
//   - status lifecycle (idle → rebuilding → idle on success, → failed on throw)
//   - never-rebuilt projection has sensible default state

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { DbConnection, DbTx } from "../../db/connection";
import { integer, table as pgTable, uuid } from "../../db/dialect";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { fenceLiveTable, swapShadowIntoLive } from "../../db/queries/shadow-swap";
import { asRawClient, insertOne, selectMany } from "../../db/query";
import { buildEntityTable } from "../../db/table-builder";
import { createTenantDb, type TenantDb } from "../../db/tenant-db";
import {
  createEntity,
  createRegistry,
  createTextField,
  defineApply,
  defineFeature,
} from "../../engine";
import type { ProjectionDefinition } from "../../engine/types";
import { createEventsTable } from "../../event-store";
import {
  createProjectionStateTable,
  getAllProjectionProgress,
  getProjectionState,
  listProjectionsWithState,
  rebuildProjection,
} from "../../pipeline";
import {
  createTestDb,
  type TestDb,
  TestUsers,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "../../stack";

// --- Test fixtures ---

const itemEntity = createEntity({
  table: "read_rebuild_items",
  fields: {
    groupId: createTextField({ required: true }),
    name: createTextField({ required: true }),
  },
  softDelete: true,
});
const itemTable = buildEntityTable("rebuild-item", itemEntity);

const itemsPerGroupTable = pgTable("read_rebuild_items_per_group", {
  groupId: uuid("group_id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  itemCount: integer("item_count").notNull().default(0),
});

async function bump(tx: unknown, groupId: string, tenantId: string, delta: number): Promise<void> {
  await asRawClient(tx).unsafe(
    `INSERT INTO "read_rebuild_items_per_group" (group_id, tenant_id, item_count) VALUES ($1::uuid, $2::uuid, $3) ON CONFLICT (group_id) DO UPDATE SET item_count = read_rebuild_items_per_group.item_count + $3`,
    [groupId, tenantId, delta],
  );
}

type ItemCreated = { groupId: string };
type ItemRestoreOrDelete = { previous: { groupId: string } };

const itemsPerGroupProjection: ProjectionDefinition = {
  name: "items-per-group",
  source: "rebuild-item",
  table: itemsPerGroupTable,
  apply: {
    "rebuild-item.created": defineApply<ItemCreated>(async (event, tx) => {
      await bump(tx, event.payload.groupId, event.tenantId, 1);
    }),
    "rebuild-item.deleted": defineApply<ItemRestoreOrDelete>(async (event, tx) => {
      await bump(tx, event.payload.previous.groupId, event.tenantId, -1);
    }),
    "rebuild-item.restored": defineApply<ItemRestoreOrDelete>(async (event, tx) => {
      await bump(tx, event.payload.previous.groupId, event.tenantId, 1);
    }),
  },
};

const feature = defineFeature("rebuildtest", (r) => {
  r.entity("rebuild-item", itemEntity);
  r.projection(itemsPerGroupProjection);
});

const admin = TestUsers.admin;
let testDb: TestDb;
let tdb: TenantDb;
const registry = createRegistry([feature]);
const qualifiedProjectionName = "rebuildtest:projection:items-per-group";

// Drizzle identifier for the executor.
const executor = createEventStoreExecutor(itemTable, itemEntity, { entityName: "rebuild-item" });

beforeAll(async () => {
  testDb = await createTestDb();
  await unsafeCreateEntityTable(testDb.db, itemEntity, "rebuild-item");
  await createEventsTable(testDb.db);
  await createProjectionStateTable(testDb.db);
  await unsafePushTables(testDb.db, { rebuildItemsPerGroup: itemsPerGroupTable });
  tdb = createTenantDb(testDb.db, admin.tenantId);
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await asRawClient(testDb.db).unsafe(
    `TRUNCATE kumiko_events, read_rebuild_items, read_rebuild_items_per_group, kumiko_projections RESTART IDENTITY CASCADE`,
  );
});

// --- Live-apply helper: use the dispatcher pipeline so projections fire.
// For rebuild-only tests we can bypass live apply and just append events
// directly — the point of rebuild is to reconstruct state from events alone.

async function appendCreatedEvent(groupId: string, name: string): Promise<void> {
  // Use the executor directly — this fires events + the entity row, but
  // NOT the projection (pipeline not wired). Perfect for "live has no
  // projection state, rebuild reconstructs it" scenarios.
  await executor.create({ groupId, name }, admin, tdb);
}

async function getCount(groupId: string): Promise<number | undefined> {
  const [row] = await selectMany(testDb.db, itemsPerGroupTable, { groupId: groupId });
  return row?.itemCount;
}

describe("rebuildProjection — happy path", () => {
  test("replays events and produces correct counter state", async () => {
    const group = "00000000-0000-4000-8000-000000000001";
    await appendCreatedEvent(group, "item1");
    await appendCreatedEvent(group, "item2");
    await appendCreatedEvent(group, "item3");

    // Projection table is empty — pipeline wasn't wired in these writes.
    expect(await getCount(group)).toBeUndefined();

    const result = await rebuildProjection(qualifiedProjectionName, {
      db: testDb.db,
      registry,
    });

    expect(result.projection).toBe(qualifiedProjectionName);
    expect(result.eventsProcessed).toBe(3);
    expect(result.lastProcessedEventId).toBeGreaterThan(0n);

    // Counter now reflects all three creates.
    expect(await getCount(group)).toBe(3);
  });

  test("rebuild wipes existing state before replay (no double-count)", async () => {
    const group = "00000000-0000-4000-8000-000000000002";
    await appendCreatedEvent(group, "a");
    await appendCreatedEvent(group, "b");

    // Seed the projection table with a stale/wrong value.
    await insertOne(testDb.db, itemsPerGroupTable, {
      groupId: group,
      tenantId: admin.tenantId,
      itemCount: 999,
    });

    const result = await rebuildProjection(qualifiedProjectionName, {
      db: testDb.db,
      registry,
    });

    expect(result.eventsProcessed).toBe(2);
    // Not 999+2, not 999 — the shadow is built empty and swapped over the
    // stale live table.
    expect(await getCount(group)).toBe(2);
  });

  test("handles events across multiple groups and aggregate IDs", async () => {
    const groupA = "00000000-0000-4000-8000-000000000010";
    const groupB = "00000000-0000-4000-8000-000000000011";

    await appendCreatedEvent(groupA, "a1");
    await appendCreatedEvent(groupB, "b1");
    await appendCreatedEvent(groupA, "a2");
    await appendCreatedEvent(groupA, "a3");
    await appendCreatedEvent(groupB, "b2");

    const result = await rebuildProjection(qualifiedProjectionName, {
      db: testDb.db,
      registry,
    });

    expect(result.eventsProcessed).toBe(5);
    expect(await getCount(groupA)).toBe(3);
    expect(await getCount(groupB)).toBe(2);
  });

  test("rebuild on empty event log is a no-op with 0 events processed", async () => {
    const result = await rebuildProjection(qualifiedProjectionName, {
      db: testDb.db,
      registry,
    });
    expect(result.eventsProcessed).toBe(0);
    expect(result.lastProcessedEventId).toBe(0n);
  });
});

describe("rebuildProjection — state table lifecycle", () => {
  test("writes state row with status=idle + lastRebuildAt after success", async () => {
    const group = "00000000-0000-4000-8000-000000000020";
    await appendCreatedEvent(group, "one");

    // Before: no state row.
    expect(await getProjectionState(testDb.db, qualifiedProjectionName)).toBeNull();

    await rebuildProjection(qualifiedProjectionName, { db: testDb.db, registry });

    const state = await getProjectionState(testDb.db, qualifiedProjectionName);
    expect(state?.status).toBe("idle");
    expect(state?.lastProcessedEventId).toBeGreaterThan(0n);
    expect(state?.lastRebuildAt).not.toBeNull();
    expect(state?.lastError).toBeNull();
  });

  test("subsequent rebuild overwrites state row (status + timestamp)", async () => {
    const group = "00000000-0000-4000-8000-000000000021";
    await appendCreatedEvent(group, "first");
    await rebuildProjection(qualifiedProjectionName, { db: testDb.db, registry });
    const first = await getProjectionState(testDb.db, qualifiedProjectionName);

    // Wait a tick so timestamp difference is visible.
    await new Promise((r) => setTimeout(r, 20));
    await appendCreatedEvent(group, "second");
    await rebuildProjection(qualifiedProjectionName, { db: testDb.db, registry });

    const second = await getProjectionState(testDb.db, qualifiedProjectionName);
    if (!first?.lastRebuildAt || !second?.lastRebuildAt) throw new Error("missing lastRebuildAt");
    expect(Temporal.Instant.compare(second.lastRebuildAt, first.lastRebuildAt)).toBeGreaterThan(0);
    expect(second?.lastProcessedEventId).toBeGreaterThan(first?.lastProcessedEventId ?? 0n);
  });
});

describe("rebuildProjection — error path", () => {
  test("apply throw rolls the shadow + partial replay back, marks status=failed", async () => {
    const group = "00000000-0000-4000-8000-000000000030";
    await appendCreatedEvent(group, "keeper-1");
    await appendCreatedEvent(group, "keeper-2");

    // First rebuild succeeds — leaves counter at 2.
    await rebuildProjection(qualifiedProjectionName, { db: testDb.db, registry });
    expect(await getCount(group)).toBe(2);

    // Construct a broken registry where apply("rebuild-item.created") throws.
    const brokenFeature = defineFeature("brokentest", (r) => {
      r.entity("rebuild-item", itemEntity);
      r.projection({
        ...itemsPerGroupProjection,
        name: "items-per-group",
        apply: {
          "rebuild-item.created": async () => {
            throw new Error("boom");
          },
        },
      });
    });
    const brokenRegistry = createRegistry([brokenFeature]);
    const brokenName = "brokentest:projection:items-per-group";

    // Rebuild throws.
    await expect(
      rebuildProjection(brokenName, { db: testDb.db, registry: brokenRegistry }),
    ).rejects.toThrow("boom");

    // The broken rebuild targets a DIFFERENT projection name; its shadow
    // rolled back and never swapped. Our original projection's rows are
    // untouched either way.
    expect(await getCount(group)).toBe(2);

    // State of the broken projection is "failed" with the error message.
    const state = await getProjectionState(testDb.db, brokenName);
    expect(state?.status).toBe("failed");
    expect(state?.lastError).toContain("boom");
  });

  test("broken rebuild of EXISTING projection keeps OLD rows intact", async () => {
    const group = "00000000-0000-4000-8000-000000000031";
    await appendCreatedEvent(group, "a");
    await appendCreatedEvent(group, "b");
    await appendCreatedEvent(group, "c");

    // First rebuild leaves counter at 3.
    await rebuildProjection(qualifiedProjectionName, { db: testDb.db, registry });
    expect(await getCount(group)).toBe(3);

    // Now attempt a rebuild with a broken apply under the SAME projection name.
    const brokenFeature = defineFeature("rebuildtest", (r) => {
      r.entity("rebuild-item", itemEntity);
      r.projection({
        ...itemsPerGroupProjection,
        apply: {
          "rebuild-item.created": async () => {
            throw new Error("poisoned");
          },
        },
      });
    });
    const brokenRegistry = createRegistry([brokenFeature]);

    await expect(
      rebuildProjection(qualifiedProjectionName, { db: testDb.db, registry: brokenRegistry }),
    ).rejects.toThrow("poisoned");

    // CRITICAL: the old counter rows survive. The shadow rebuild replays into
    // a separate table and only swaps as the last step — a throw mid-replay
    // rolls the shadow back and the live table was never touched. Without this
    // the rebuild would be worse than not rebuilding at all.
    expect(await getCount(group)).toBe(3);

    // State reflects the failure.
    const state = await getProjectionState(testDb.db, qualifiedProjectionName);
    expect(state?.status).toBe("failed");
    expect(state?.lastError).toContain("poisoned");
  });

  test("unknown projection name throws with helpful message", async () => {
    await expect(rebuildProjection("nonexistent", { db: testDb.db, registry })).rejects.toThrow(
      /not registered/,
    );
  });
});

describe("listProjectionsWithState", () => {
  test("lists every registered projection with combined state info", async () => {
    // Before any rebuild: state field indicates never-rebuilt.
    const before = await listProjectionsWithState(testDb.db, registry);
    expect(before).toHaveLength(1);
    expect(before[0]?.name).toBe(qualifiedProjectionName);
    expect(before[0]?.status).toBe("never-rebuilt");
    expect(before[0]?.sources).toEqual(["rebuild-item"]);

    // After rebuild: status reflects DB state.
    await appendCreatedEvent("00000000-0000-4000-8000-000000000040", "x");
    await rebuildProjection(qualifiedProjectionName, { db: testDb.db, registry });

    const after = await listProjectionsWithState(testDb.db, registry);
    expect(after[0]?.status).toBe("idle");
    expect(after[0]?.lastRebuildAt).not.toBeNull();
  });
});

describe("getAllProjectionProgress", () => {
  test("computes lag = highWaterMark - cursor for caught-up projection", async () => {
    // Empty event-log → HWM=0n, lag=0n, projection never-rebuilt → cursor=0n.
    const empty = await getAllProjectionProgress(testDb.db, registry);
    expect(empty[0]?.highWaterMark).toBe(0n);
    expect(empty[0]?.lag).toBe(0n);

    // Seed some events but skip rebuild → HWM advances, cursor stays 0n,
    // lag = HWM. This is the "behind" state an ops dashboard sees before
    // someone triggers a rebuild.
    await appendCreatedEvent("00000000-0000-4000-8000-000000000060", "a");
    await appendCreatedEvent("00000000-0000-4000-8000-000000000061", "b");
    await appendCreatedEvent("00000000-0000-4000-8000-000000000062", "c");

    const behind = await getAllProjectionProgress(testDb.db, registry);
    expect(behind[0]?.highWaterMark).toBe(3n);
    expect(behind[0]?.lastProcessedEventId).toBe(0n);
    expect(behind[0]?.lag).toBe(3n);

    // Nach rebuild: cursor = HWM, lag wieder 0.
    await rebuildProjection(qualifiedProjectionName, { db: testDb.db, registry });
    const caughtUp = await getAllProjectionProgress(testDb.db, registry);
    expect(caughtUp[0]?.highWaterMark).toBe(3n);
    expect(caughtUp[0]?.lastProcessedEventId).toBe(3n);
    expect(caughtUp[0]?.lag).toBe(0n);
  });
});

describe("rebuildProjection — metrics callback", () => {
  test("invokes onMetrics with the RebuildResult on success", async () => {
    const group = "00000000-0000-4000-8000-000000000050";
    await appendCreatedEvent(group, "a");
    await appendCreatedEvent(group, "b");

    const calls: Array<{
      projection: string;
      eventsProcessed: number;
      durationMs: number;
    }> = [];
    await rebuildProjection(qualifiedProjectionName, {
      db: testDb.db,
      registry,
      onMetrics: (r) =>
        calls.push({
          projection: r.projection,
          eventsProcessed: r.eventsProcessed,
          durationMs: r.durationMs,
        }),
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.projection).toBe(qualifiedProjectionName);
    expect(calls[0]?.eventsProcessed).toBe(2);
    expect(calls[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("rebuildProjection — meter emission", () => {
  test("emits success=true metric + events counter on happy path", async () => {
    const { RecordingMeter } = await import("../../observability/recording-meter");
    const { registerStandardMetrics } = await import("../../observability/standard-metrics");

    const group = "00000000-0000-4000-8000-000000000060";
    await appendCreatedEvent(group, "a");
    await appendCreatedEvent(group, "b");
    await appendCreatedEvent(group, "c");

    const events: Array<{
      type: string;
      name: string;
      value: number;
      labels: Record<string, string | number> | undefined;
    }> = [];
    const meter = new RecordingMeter((e) =>
      events.push({
        type: e.type,
        name: e.name,
        value: e.value,
        labels: e.labels as Record<string, string | number> | undefined,
      }),
    );
    registerStandardMetrics(meter);

    await rebuildProjection(qualifiedProjectionName, { db: testDb.db, registry, meter });

    const duration = events.find((e) => e.name === "kumiko_projection_rebuild_duration_seconds");
    expect(duration).toBeDefined();
    expect(duration?.type).toBe("histogram.observe");
    expect(duration?.labels?.["projection"]).toBe(qualifiedProjectionName);
    expect(duration?.labels?.["success"]).toBe("true");
    expect(duration?.value).toBeGreaterThanOrEqual(0);

    const counter = events.find((e) => e.name === "kumiko_projection_rebuild_events_total");
    expect(counter).toBeDefined();
    expect(counter?.type).toBe("counter.inc");
    expect(counter?.value).toBe(3);
    expect(counter?.labels?.["projection"]).toBe(qualifiedProjectionName);
  });

  test("emits success=false metric when apply throws", async () => {
    const { RecordingMeter } = await import("../../observability/recording-meter");
    const { registerStandardMetrics } = await import("../../observability/standard-metrics");

    const group = "00000000-0000-4000-8000-000000000061";
    await appendCreatedEvent(group, "a");

    const brokenFeature = defineFeature("failmeter", (r) => {
      r.entity("rebuild-item", itemEntity);
      r.projection({
        ...itemsPerGroupProjection,
        apply: {
          "rebuild-item.created": async () => {
            throw new Error("metric-failure-probe");
          },
        },
      });
    });
    const brokenRegistry = createRegistry([brokenFeature]);

    const events: Array<{
      type: string;
      name: string;
      value: number;
      labels: Record<string, string | number> | undefined;
    }> = [];
    const meter = new RecordingMeter((e) =>
      events.push({
        type: e.type,
        name: e.name,
        value: e.value,
        labels: e.labels as Record<string, string | number> | undefined,
      }),
    );
    registerStandardMetrics(meter);

    await expect(
      rebuildProjection("failmeter:projection:items-per-group", {
        db: testDb.db,
        registry: brokenRegistry,
        meter,
      }),
    ).rejects.toThrow("metric-failure-probe");

    const duration = events.find((e) => e.name === "kumiko_projection_rebuild_duration_seconds");
    expect(duration).toBeDefined();
    expect(duration?.labels?.["success"]).toBe("false");
    expect(duration?.labels?.["projection"]).toBe("failmeter:projection:items-per-group");
  });
});

describe("rebuildProjection — cancellation", () => {
  test("pre-aborted signal: rebuild throws, shadow rolls back, projection state preserved", async () => {
    // Setup: events on the log + a clean rebuild → projection has known
    // counter state. Then call rebuildProjection with a pre-aborted
    // controller. The first throwIfAborted() inside the apply loop
    // throws, the TX rolls back, and the projection row from the prior
    // good rebuild is still there.
    //
    // Why pre-aborted instead of mid-replay: the apply hook is wired in
    // the projection definition at registry-build-time, so injecting
    // "abort after event N" requires a separate registered projection.
    // This test pins the rollback semantics — a separate test would be
    // needed to exercise mid-loop abort, but the rollback path is the
    // same code so the value-add is small.
    const group = "00000000-0000-4000-8000-0000000000c1";
    for (let i = 0; i < 10; i++) {
      await appendCreatedEvent(group, `cancel-${i}`);
    }

    await rebuildProjection(qualifiedProjectionName, {
      db: testDb.db,
      registry,
    });
    const before = await getCount(group);
    expect(before).toBe(10);

    const controller = new AbortController();
    controller.abort();

    let thrown: unknown;
    try {
      await rebuildProjection(qualifiedProjectionName, {
        db: testDb.db,
        registry,
        signal: controller.signal,
      });
    } catch (e) {
      thrown = e;
    }
    expect((thrown as Error).name).toBe("AbortError");

    const after = await getCount(group);
    expect(after).toBe(before);
  });
});

describe("rebuildProjection — online shadow-swap mechanics", () => {
  // Self-contained fixtures: a separate projection so the count-sensitive
  // list/progress tests above keep seeing exactly one registered projection.
  const swapEntity = createEntity({
    table: "read_swap_indexed",
    fields: { label: createTextField({ required: true }) },
  });
  const swapTable = buildEntityTable("swap-indexed", swapEntity);
  // Empty apply: a 0-event rebuild still builds the shadow + swaps it in, so
  // this exercises the table-recreation + swap path without wiring events.
  const swapProjection: ProjectionDefinition = {
    name: "swap-indexed-proj",
    source: "swap-indexed",
    table: swapTable,
    apply: {},
  };
  const swapFeature = defineFeature("swaptest", (r) => {
    r.entity("swap-indexed", swapEntity);
    r.projection(swapProjection);
  });
  const swapRegistry = createRegistry([swapFeature]);
  const swapProjName = "swaptest:projection:swap-indexed-proj";

  test("swap moves the shadow into public with canonical index names", async () => {
    await unsafeCreateEntityTable(testDb.db, swapEntity, "swap-indexed");
    await rebuildProjection(swapProjName, { db: testDb.db, registry: swapRegistry });

    // The tenant_id index carries its canonical name after SET SCHEMA. Future
    // migrations DROP/CREATE INDEX by exactly this name, so a rename here would
    // silently break them — this is the index-rename trap the shadow-schema
    // approach dissolves.
    const idx = await asRawClient(testDb.db).unsafe<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'read_swap_indexed' ORDER BY indexname`,
    );
    expect(idx.map((r) => r.indexname)).toContain("read_swap_indexed_tenant_id_idx");

    // Nothing left behind in the shadow schema — the table moved out via SET SCHEMA.
    const leftover = await asRawClient(testDb.db).unsafe<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'kumiko_rebuild' AND tablename = 'read_swap_indexed'`,
    );
    expect(leftover).toHaveLength(0);
  });

  test("cleans a stale shadow table left by a crashed rebuild", async () => {
    await unsafeCreateEntityTable(testDb.db, swapEntity, "swap-indexed");
    // A crashed prior rebuild leaves a shadow with the wrong shape behind.
    await asRawClient(testDb.db).unsafe(`CREATE SCHEMA IF NOT EXISTS kumiko_rebuild`);
    await asRawClient(testDb.db).unsafe(`DROP TABLE IF EXISTS kumiko_rebuild.read_swap_indexed`);
    await asRawClient(testDb.db).unsafe(
      `CREATE TABLE kumiko_rebuild.read_swap_indexed (stale int)`,
    );

    // Rebuild drops the stale shadow before building the real one — succeeds.
    await rebuildProjection(swapProjName, { db: testDb.db, registry: swapRegistry });

    const cols = await asRawClient(testDb.db).unsafe<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'read_swap_indexed'`,
    );
    const colNames = cols.map((c) => c.column_name);
    expect(colNames).not.toContain("stale");
    expect(colNames).toContain("tenant_id");
  });

  test("live table stays readable + intact during replay (no lock until swap)", async () => {
    const group = "00000000-0000-4000-8000-0000000000d1";
    await appendCreatedEvent(group, "a");
    await appendCreatedEvent(group, "b");
    await rebuildProjection(qualifiedProjectionName, { db: testDb.db, registry });
    expect(await getCount(group)).toBe(2);

    // A probe apply reads the LIVE table from a SEPARATE pooled connection
    // (default search_path = public) on its first invocation, while the rebuild
    // tx is mid-replay against its shadow. An in-place TRUNCATE would hold an
    // ACCESS EXCLUSIVE lock and deadlock this read; the shadow swap leaves the
    // live table unlocked, so it returns the pre-swap rows promptly.
    let liveDuringReplay: number | undefined = -1;
    const probeFeature = defineFeature("probetest", (r) => {
      r.entity("rebuild-item", itemEntity);
      r.projection({
        ...itemsPerGroupProjection,
        apply: {
          "rebuild-item.created": defineApply<ItemCreated>(async (event, tx) => {
            if (liveDuringReplay === -1) liveDuringReplay = await getCount(group);
            await bump(tx, event.payload.groupId, event.tenantId, 1);
          }),
        },
      });
    });
    const probeRegistry = createRegistry([probeFeature]);

    await rebuildProjection("probetest:projection:items-per-group", {
      db: testDb.db,
      registry: probeRegistry,
    });

    expect(liveDuringReplay).toBe(2);
    expect(await getCount(group)).toBe(2);
  });

  test("warm-pool writes succeed after the swap changes the table OID", async () => {
    // The swap replaces the physical table (new OID) — TRUNCATE never did.
    // A live write through the same long-lived pool AFTER the swap (the
    // steady-state apply path, typed query API) must still resolve the
    // swapped relation, including across a second rebuild + swap.
    const group = "00000000-0000-4000-8000-0000000000e1";
    await appendCreatedEvent(group, "a");
    await rebuildProjection(qualifiedProjectionName, { db: testDb.db, registry });
    expect(await getCount(group)).toBe(1);

    const other = "00000000-0000-4000-8000-0000000000e2";
    await insertOne(testDb.db, itemsPerGroupTable, {
      groupId: other,
      tenantId: admin.tenantId,
      itemCount: 5,
    });
    expect(await getCount(other)).toBe(5);

    await appendCreatedEvent(group, "b");
    await rebuildProjection(qualifiedProjectionName, { db: testDb.db, registry });
    expect(await getCount(group)).toBe(2);
  });
});

describe("rebuildProjection — live-tail catch-up (#363 Phase 2)", () => {
  test("a write committed during the replay window survives the swap (Phase 1 lost it)", async () => {
    const group = "00000000-0000-4000-8000-0000000000f1";
    await appendCreatedEvent(group, "a"); // event id 1
    await appendCreatedEvent(group, "b"); // event id 2

    let injected = 0;
    await rebuildProjection(qualifiedProjectionName, {
      db: testDb.db,
      registry,
      // Fires after the unlocked bulk drain (events 1+2 applied) and before the
      // fence. A 3rd event committed here is exactly the write Phase 1's single
      // up-front SELECT missed — the fenced final drain must pick it up.
      __test_onBeforeFence: async () => {
        injected++;
        await appendCreatedEvent(group, "c"); // event id 3, separate connection
      },
    });

    expect(injected).toBe(1); // seam ran exactly once
    // 2 bulk + 1 caught-up tail. Under Phase 1's up-front SELECT this is 2.
    expect(await getCount(group)).toBe(3);
  });

  test("(#443) a lower-id write committed late during replay is recovered under the fence", async () => {
    // bigserial assigns ids at INSERT (pre-commit); a cross-aggregate write can
    // commit an id BELOW the cursor the unlocked drain already advanced past, and
    // the fenced final drain (`WHERE id > cursor`) never revisits it. Under the
    // fence the subscribed-event set is final, so a count re-check detects the
    // shortfall and re-replays the full log into a fresh shadow — groupX, whose
    // low-id event committed late, is no longer lost. See #443.
    const db = testDb.db as DbConnection; // @cast-boundary test-harness (TestDb.db is intentionally unknown)
    const groupX = "00000000-0000-4000-8000-000000000201";
    const groupY = "00000000-0000-4000-8000-000000000202";
    const aggX = "00000000-0000-4000-8000-0000000002a1";

    // Connection A inserts aggregate X's event (grabs the LOW id) but holds its
    // tx open — uncommitted, so the rebuild's READ COMMITTED scan can't see it.
    let releaseX!: () => void;
    const xGate = new Promise<void>((resolve) => {
      releaseX = resolve;
    });
    let markXInserted!: () => void;
    const xInserted = new Promise<void>((resolve) => {
      markXInserted = resolve;
    });
    const xDone = db.begin(async (xtx: DbTx) => {
      await asRawClient(xtx).unsafe(
        `INSERT INTO "kumiko_events"
           (aggregate_id, aggregate_type, tenant_id, version, type, payload, metadata, created_by)
         VALUES ($1::uuid, 'rebuild-item', $2::uuid, 0, 'rebuild-item.created', $3::jsonb, '{}'::jsonb, 'test')`,
        [aggX, admin.tenantId, JSON.stringify({ groupId: groupX })],
      );
      markXInserted();
      await xGate;
    });
    await xInserted;

    // Aggregate Y commits AFTER X grabbed its id → Y carries the HIGHER id.
    await appendCreatedEvent(groupY, "y");

    await rebuildProjection(qualifiedProjectionName, {
      db: testDb.db,
      registry,
      __test_onBeforeFence: async () => {
        // X commits now: its low id becomes visible, but below the cursor that
        // already advanced past Y's higher id.
        releaseX();
        await xDone;
      },
    });

    expect(await getCount(groupY)).toBe(1);
    expect(await getCount(groupX)).toBe(1); // #443 fixed: fenced count re-check re-replayed the missed low-id event
  });

  test("the rebuild tx sees concurrently-committed rows (READ COMMITTED, not a frozen snapshot)", async () => {
    // The catch-up loop only works if each fresh SELECT in the rebuild tx sees
    // rows other connections committed since the previous batch. Under
    // REPEATABLE READ the loop would be silently inert — pin the isolation.
    const group = "00000000-0000-4000-8000-0000000000f2";
    const db = testDb.db as DbConnection; // @cast-boundary test-harness (TestDb.db is intentionally unknown)
    await db.begin(async (tx: DbTx) => {
      const before = await asRawClient(tx).unsafe<{ n: number }>(
        `SELECT count(*)::int AS n FROM "read_rebuild_items_per_group"`,
      );
      // Separate pooled connection commits a row mid-transaction.
      await insertOne(testDb.db, itemsPerGroupTable, {
        groupId: group,
        tenantId: admin.tenantId,
        itemCount: 1,
      });
      const after = await asRawClient(tx).unsafe<{ n: number }>(
        `SELECT count(*)::int AS n FROM "read_rebuild_items_per_group"`,
      );
      expect(after[0]?.n ?? 0).toBe((before[0]?.n ?? 0) + 1);
    });
  });

  test("a write blocked through the fence+swap is atomic with its partner write (cutover semantics)", async () => {
    // Drive the cutover primitive directly (fenceLiveTable + swapShadowIntoLive):
    // a concurrent tx does a partner write + a projection apply that BLOCKS on
    // the fence and is carried through DROP + SET SCHEMA (the live table's OID
    // changes). However Postgres resolves the dropped-OID write, the partner
    // write and the apply share one tx → both commit or both roll back. The
    // empirical outcome (errors vs. retargets) is logged for the changeset note.
    const group = "00000000-0000-4000-8000-0000000000f3";
    await asRawClient(testDb.db).unsafe(
      `CREATE TABLE IF NOT EXISTS "cutover_probe" (id int primary key)`,
    );
    await asRawClient(testDb.db).unsafe(`DELETE FROM "cutover_probe"`);

    // Pre-build a shadow under the canonical name so SET SCHEMA can move it into
    // public — mirrors what buildShadowTable produces for a real rebuild.
    await asRawClient(testDb.db).unsafe(`CREATE SCHEMA IF NOT EXISTS kumiko_rebuild`);
    await asRawClient(testDb.db).unsafe(
      `DROP TABLE IF EXISTS kumiko_rebuild."read_rebuild_items_per_group"`,
    );
    await asRawClient(testDb.db).unsafe(
      `CREATE TABLE kumiko_rebuild."read_rebuild_items_per_group" (LIKE public."read_rebuild_items_per_group" INCLUDING ALL)`,
    );

    let bOutcome = "pending";
    let bDone: Promise<void> | null = null;
    const db = testDb.db as DbConnection; // @cast-boundary test-harness (TestDb.db is intentionally unknown)
    await db.begin(async (atx: DbTx) => {
      await fenceLiveTable(atx, "read_rebuild_items_per_group", 10_000);

      // Connection B: partner write + a projection apply that blocks on the fence.
      bDone = db
        .begin(async (btx: DbTx) => {
          await asRawClient(btx).unsafe(`INSERT INTO "cutover_probe" (id) VALUES (1)`);
          await bump(btx, group, admin.tenantId, 1); // ROW EXCLUSIVE → blocks on the fence
        })
        .then(() => {
          bOutcome = "committed";
        })
        .catch((e: unknown) => {
          bOutcome = `errored: ${e instanceof Error ? e.message : String(e)}`;
        });

      // Let B reach its lock-wait before we swap the table out from under it.
      // NOT awaiting bDone here: B can only finish once A commits (releases the
      // fence) — awaiting it inside the tx would deadlock.
      await new Promise((r) => setTimeout(r, 300));
      await swapShadowIntoLive(atx, "read_rebuild_items_per_group");
    });
    if (bDone) await bDone; // A committed → B unblocks and resolves

    console.log(`[#363 cutover] blocked writer outcome: ${bOutcome}`);

    // Load-bearing invariant: partner write present ⟺ projection row present.
    const probe = await asRawClient(testDb.db).unsafe<{ n: number }>(
      `SELECT count(*)::int AS n FROM "cutover_probe" WHERE id = 1`,
    );
    const probePresent = (probe[0]?.n ?? 0) > 0;
    const rowPresent = (await getCount(group)) !== undefined;
    expect(probePresent).toBe(rowPresent);

    await asRawClient(testDb.db).unsafe(`DROP TABLE IF EXISTS "cutover_probe"`);
  });
});
