// Runtime guard #722: before the rebuild swaps the shadow over the live table,
// abort if a live row has NO event in the projection's source streams — a row
// no replay can reconstruct (#498 ghost, direct-inserted without a .created
// event), which the swap would silently drop.
//
// The guard is deliberately narrow (event EXISTENCE only, not a column diff):
// the framework legitimately makes live diverge from a fresh replay in shipped
// ways (blind-index erase→NULL, sensitive-strip, archived-stream wipe, the #494
// backfill flow). Those rows all HAVE an event, so they are not ghosts and the
// guard leaves them alone — proven by the "direct column-write" test below.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { type BunTestDb, createTestDb } from "../../bun-db/__tests__/bun-test-db";
import { asRawClient, insertOne, selectMany } from "../../db/query";
import { createBooleanField, createEntity, createTextField, defineFeature } from "../../engine";
import { createRegistry } from "../../engine/registry";
import { archiveStream, createArchivedStreamsTable, createEventsTable } from "../../event-store";
import { rebuildProjection } from "../../pipeline";
import { createProjectionStateTable } from "../../pipeline/projection-state";
import { TestUsers, unsafeCreateEntityTable } from "../../stack";
import { ensureTemporalPolyfill } from "../../time/polyfill";
import { createEventStoreExecutor } from "../event-store-executor";
import { buildEntityTable } from "../table-builder";
import { createTenantDb, type TenantDb } from "../tenant-db";

const userEntity = createEntity({
  table: "read_unreachable_users",
  fields: {
    email: createTextField({ required: true }),
    firstName: createTextField(),
    isEnabled: createBooleanField({ default: true }),
  },
  softDelete: true,
});

const userFeature = defineFeature("unreachabletest", (r) => {
  r.entity("user", userEntity);
});

const userTable = buildEntityTable("user", userEntity);
const projectionName = "unreachabletest:projection:user-entity";
const registry = createRegistry([userFeature]);

let testDb: BunTestDb;
let tdb: TenantDb;
const adminUser = TestUsers.admin;

beforeAll(async () => {
  await ensureTemporalPolyfill();
  testDb = await createTestDb();
  await unsafeCreateEntityTable(testDb.db, userEntity, "user");
  await createEventsTable(testDb.db);
  await createArchivedStreamsTable(testDb.db);
  await createProjectionStateTable(testDb.db);
  tdb = createTenantDb(testDb.db, adminUser.tenantId);
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await asRawClient(testDb.db).unsafe(
    `TRUNCATE kumiko_events, kumiko_archived_streams, read_unreachable_users, kumiko_projections RESTART IDENTITY CASCADE`,
  );
});

async function snapshotTable(): Promise<readonly Record<string, unknown>[]> {
  const rows = await selectMany(
    testDb.db,
    userTable,
    {},
    { orderBy: { col: "id", direction: "asc" } },
  );
  return rows as readonly Record<string, unknown>[];
}

describe("assert-no-unreachable-live-rows / #722 ghost-row guard", () => {
  test("clean executor-only projection rebuilds without firing the guard", async () => {
    const crud = createEventStoreExecutor(userTable, userEntity, { entityName: "user" });
    await crud.create({ email: "a@test.de", firstName: "Alice" }, adminUser, tdb);
    await crud.create({ email: "b@test.de", firstName: "Bob" }, adminUser, tdb);
    const before = await snapshotTable();

    const result = await rebuildProjection(projectionName, { db: testDb.db, registry });

    expect(result.eventsProcessed).toBe(2);
    expect(result.columnDriftCount).toBe(0);
    expect(await snapshotTable()).toEqual(before);
  });

  test("ghost row (no backing event) → swap aborts, live untouched", async () => {
    const crud = createEventStoreExecutor(userTable, userEntity, { entityName: "user" });
    const a = await crud.create({ email: "a@test.de", firstName: "Alice" }, adminUser, tdb);
    if (!a.isSuccess) throw new Error("setup failed");

    // Drift: clone the event-backed row into a second id WITHOUT appending an
    // event — the #498 ghost. No replay can ever reconstruct it.
    const [liveRow] = await selectMany(testDb.db, userTable, { id: a.data.id as string });
    if (!liveRow) throw new Error("live row missing");
    const ghostId = crypto.randomUUID();
    // Deliberately bypass the EXECUTOR_ONLY brand: the whole point is to write
    // the entity table WITHOUT going through the executor — the production bug
    // the guard defends against.
    const writable = userTable as unknown as Parameters<typeof insertOne>[1];
    await insertOne(tdb, writable, { ...liveRow, id: ghostId, email: "ghost@test.de" });
    expect(await snapshotTable()).toHaveLength(2);

    await expect(rebuildProjection(projectionName, { db: testDb.db, registry })).rejects.toThrow(
      // #915: exact count below the truncation limit, no misleading "+" suffix.
      /^projection-rebuild ".*": 1 live rows in ".*" have no\s+event in the projection's source streams/,
    );

    // Swap never ran: both rows — including the ghost — survive.
    const after = await snapshotTable();
    expect(after).toHaveLength(2);
    expect(after.map((r) => r["id"])).toContain(ghostId);
  });

  test("direct column-write on an event-backed row does NOT trip the guard", async () => {
    // The row has a .created event, so it is not a ghost. Its column state was
    // direct-written without an event (the #494 / blind-index-erase class) — the
    // guard is event-existence-only and leaves it alone; the replay overwrites
    // the column from the event, which is the intended, shipped behavior.
    const crud = createEventStoreExecutor(userTable, userEntity, { entityName: "user" });
    const a = await crud.create({ email: "a@test.de", firstName: "Alice" }, adminUser, tdb);
    if (!a.isSuccess) throw new Error("setup failed");

    await asRawClient(testDb.db).unsafe(
      `UPDATE read_unreachable_users SET first_name = 'DirectWrite' WHERE id = $1`,
      [a.data.id],
    );

    // No throw — the row is event-backed. Rebuild replays the create event.
    // #916: the direct write IS reported as column drift (non-blocking) —
    // this is the exact #494 healing case the guard leaves to replay.
    const result = await rebuildProjection(projectionName, { db: testDb.db, registry });
    expect(result.columnDriftCount).toBe(1);

    const [rebuilt] = await selectMany(testDb.db, userTable, { id: a.data.id as string });
    expect(rebuilt?.["email"]).toBe("a@test.de");
    // The direct write is overwritten by the replay — deliberately allowed.
    expect(rebuilt?.["firstName"]).toBe("Alice");
  });

  test("columnDriftCount reports the TRUE total, not capped at the 20-row sample limit", async () => {
    const crud = createEventStoreExecutor(userTable, userEntity, { entityName: "user" });
    const created = await Promise.all(
      Array.from({ length: 21 }, (_, i) =>
        crud.create({ email: `u${i}@test.de`, firstName: `Name${i}` }, adminUser, tdb),
      ),
    );
    for (const c of created) {
      if (!c.isSuccess) throw new Error("setup failed");
      await asRawClient(testDb.db).unsafe(
        `UPDATE read_unreachable_users SET first_name = 'DirectWrite' WHERE id = $1`,
        [c.data.id],
      );
    }

    const result = await rebuildProjection(projectionName, { db: testDb.db, registry });

    // #916: the sample query is LIMITed to 20 rows, but the count must reflect
    // all 21 — a min(actual, 20) would silently understate severity to ops.
    expect(result.columnDriftCount).toBe(21);
  });

  test("archived stream (fw#832 tombstone) does NOT trip the guard", async () => {
    // archiveStream never deletes the .created event — projection rebuild
    // deliberately excludes archived streams from replay (fw#832, see
    // projection-rebuild.ts), so the row is wiped from live on swap. The
    // guard only checks event EXISTENCE, not replay-inclusion, so it must
    // not fire — this is the shipped tombstone behavior, not drift.
    const crud = createEventStoreExecutor(userTable, userEntity, { entityName: "user" });
    const a = await crud.create({ email: "a@test.de", firstName: "Alice" }, adminUser, tdb);
    if (!a.isSuccess) throw new Error("setup failed");

    await archiveStream(testDb.db, {
      tenantId: adminUser.tenantId,
      aggregateId: a.data.id as string,
      aggregateType: "user",
      archivedBy: adminUser.id,
    });

    // No throw — the row is event-backed despite being archived.
    const result = await rebuildProjection(projectionName, { db: testDb.db, registry });

    expect(result.eventsProcessed).toBe(0);
    expect(await snapshotTable()).toHaveLength(0);
  });
});
