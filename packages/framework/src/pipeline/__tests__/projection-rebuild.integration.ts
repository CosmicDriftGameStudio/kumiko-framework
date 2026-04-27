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

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import {
  integer as drizzleInteger,
  table as drizzlePgTable,
  uuid as drizzleUuid,
} from "../../db/dialect";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { buildDrizzleTable } from "../../db/table-builder";
import { createTenantDb, type TenantDb } from "../../db/tenant-db";
import { createEntity, createRegistry, createTextField, defineFeature } from "../../engine";
import type { ProjectionDefinition } from "../../engine/types";
import { createEventsTable } from "../../event-store";
import {
  createProjectionStateTable,
  getAllProjectionProgress,
  getProjectionState,
  listProjectionsWithState,
  rebuildProjection,
} from "../../pipeline";
import { createEntityTable, createTestDb, pushTables, type TestDb, TestUsers } from "../../stack";

// --- Test fixtures ---

const itemEntity = createEntity({
  table: "read_rebuild_items",
  fields: {
    groupId: createTextField({ required: true }),
    name: createTextField({ required: true }),
  },
  softDelete: true,
});
const itemTable = buildDrizzleTable("rebuild-item", itemEntity);

const itemsPerGroupTable = drizzlePgTable("read_rebuild_items_per_group", {
  groupId: drizzleUuid("group_id").primaryKey(),
  tenantId: drizzleUuid("tenant_id").notNull(),
  itemCount: drizzleInteger("item_count").notNull().default(0),
});

async function bump(tx: unknown, groupId: string, tenantId: string, delta: number): Promise<void> {
  // biome-ignore lint/suspicious/noExplicitAny: tx is DbRunner
  await (tx as any)
    .insert(itemsPerGroupTable)
    .values({ groupId, tenantId, itemCount: delta })
    .onConflictDoUpdate({
      target: itemsPerGroupTable.groupId,
      set: { itemCount: sql`${itemsPerGroupTable.itemCount} + ${delta}` },
    });
}

const itemsPerGroupProjection: ProjectionDefinition = {
  name: "items-per-group",
  source: "rebuild-item",
  table: itemsPerGroupTable,
  apply: {
    "rebuild-item.created": async (event, tx) => {
      await bump(tx, event.payload["groupId"] as string, event.tenantId, 1);
    },
    "rebuild-item.deleted": async (event, tx) => {
      const prev = event.payload["previous"] as Record<string, unknown>;
      await bump(tx, prev["groupId"] as string, event.tenantId, -1);
    },
    "rebuild-item.restored": async (event, tx) => {
      const prev = event.payload["previous"] as Record<string, unknown>;
      await bump(tx, prev["groupId"] as string, event.tenantId, 1);
    },
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
  await createEntityTable(testDb.db, itemEntity, "rebuild-item");
  await createEventsTable(testDb.db);
  await createProjectionStateTable(testDb.db);
  await pushTables(testDb.db, { rebuildItemsPerGroup: itemsPerGroupTable });
  tdb = createTenantDb(testDb.db, admin.tenantId);
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await testDb.db.execute(
    sql`TRUNCATE kumiko_events, read_rebuild_items, read_rebuild_items_per_group, kumiko_projections RESTART IDENTITY CASCADE`,
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
  const [row] = await testDb.db
    .select()
    .from(itemsPerGroupTable)
    .where(eq(itemsPerGroupTable.groupId, groupId));
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
    await testDb.db
      .insert(itemsPerGroupTable)
      .values({ groupId: group, tenantId: admin.tenantId, itemCount: 999 });

    const result = await rebuildProjection(qualifiedProjectionName, {
      db: testDb.db,
      registry,
    });

    expect(result.eventsProcessed).toBe(2);
    // Not 999+2, not 999 — TRUNCATE + replay.
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
  test("apply throw rolls TRUNCATE + partial replay back, marks status=failed", async () => {
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

    // Old counter rows are gone (TRUNCATE is inside the TX but this is a
    // DIFFERENT projection). Verify our original projection's rows WERE
    // preserved because the broken rebuild targets a different name.
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

    // CRITICAL: the old counter rows survive. TRUNCATE happened INSIDE the
    // transaction, so the rollback restored them. Without this the rebuild
    // would be worse than not rebuilding at all.
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
  test("pre-aborted signal: rebuild throws, TRUNCATE rolls back, projection state preserved", async () => {
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
