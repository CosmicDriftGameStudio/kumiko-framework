// studio#36/#46: ein fehlgeschlagener Projection-Rebuild nach `schema apply`
// durfte nicht verloren gehen — die Queue persistiert die betroffenen
// Tabellen, ein erneuter Lauf holt offene Rebuilds nach.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { integer, table as pgTable, uuid } from "../../db/dialect";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { asRawClient, selectMany } from "../../db/query";
import { writeRebuildMarker } from "../../db/rebuild-marker";
import { buildEntityTable } from "../../db/table-builder";
import { createTenantDb, type TenantDb } from "../../db/tenant-db";
import {
  createEntity,
  createRegistry,
  createTextField,
  defineApply,
  defineFeature,
  type ProjectionDefinition,
} from "../../engine";
import { createEventsTable } from "../../event-store";
import { createProjectionStateTable } from "../../pipeline";
import {
  createTestDb,
  type TestDb,
  TestUsers,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "../../stack";
import type { JobRunner } from "../../jobs/job-runner";
import {
  clearPendingRebuilds,
  enqueueProjectionRebuild,
  listPendingRebuildRows,
  listPendingRebuilds,
  PROJECTION_REBUILD_JOB,
  queueRebuildsFromMarkers,
  runPendingRebuilds,
} from "../pending-rebuilds";

const itemEntity = createEntity({
  table: "read_pending_items",
  fields: {
    groupId: createTextField({ required: true }),
    name: createTextField({ required: true }),
  },
});
const itemTable = buildEntityTable("pending-item", itemEntity);

const countsTable = pgTable("read_pending_counts", {
  groupId: uuid("group_id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  itemCount: integer("item_count").notNull().default(0),
});

// Steuerbarer Fail: simuliert einen transienten Rebuild-Fehler.
let failApply = false;

const countsProjection: ProjectionDefinition = {
  name: "pending-counts",
  source: "pending-item",
  table: countsTable,
  apply: {
    "pending-item.created": defineApply<{ groupId: string }>(async (event, tx) => {
      if (failApply) throw new Error("transient rebuild failure (test)");
      await asRawClient(tx).unsafe(
        `INSERT INTO "read_pending_counts" (group_id, tenant_id, item_count) VALUES ($1::uuid, $2::uuid, 1)
         ON CONFLICT (group_id) DO UPDATE SET item_count = read_pending_counts.item_count + 1`,
        [event.payload.groupId, event.tenantId],
      );
    }),
  },
};

const feature = defineFeature("pendingtest", (r) => {
  r.entity("pending-item", itemEntity);
  r.projection(countsProjection);
});

const admin = TestUsers.admin;
const registry = createRegistry([feature]);
const executor = createEventStoreExecutor(itemTable, itemEntity, { entityName: "pending-item" });

let testDb: TestDb;
let tdb: TenantDb;
let markerDir: string;

beforeAll(async () => {
  testDb = await createTestDb();
  await unsafeCreateEntityTable(testDb.db, itemEntity, "pending-item");
  await createEventsTable(testDb.db);
  await createProjectionStateTable(testDb.db);
  await unsafePushTables(testDb.db, { readPendingCounts: countsTable });
  tdb = createTenantDb(testDb.db, admin.tenantId);
  markerDir = mkdtempSync(join(tmpdir(), "pending-rebuilds-"));
});

afterAll(async () => {
  rmSync(markerDir, { recursive: true, force: true });
  await testDb.cleanup();
});

beforeEach(async () => {
  failApply = false;
  await asRawClient(testDb.db).unsafe(
    `TRUNCATE kumiko_events, read_pending_items, read_pending_counts, kumiko_projections RESTART IDENTITY CASCADE`,
  );
  await asRawClient(testDb.db).unsafe(`DROP TABLE IF EXISTS kumiko_pending_rebuilds`);
});

const GROUP = "00000000-0000-4000-8000-000000000001";

async function getCount(): Promise<number | undefined> {
  const [row] = await selectMany(testDb.db, countsTable, { groupId: GROUP });
  return row?.itemCount;
}

describe("pending-rebuilds queue", () => {
  test("failed rebuild stays queued — a later run without new migrations catches up", async () => {
    await executor.create({ groupId: GROUP, name: "a" }, admin, tdb);
    await executor.create({ groupId: GROUP, name: "b" }, admin, tdb);

    writeRebuildMarker(markerDir, "0001_add_counts.sql", ["read_pending_counts"]);
    const queued = await queueRebuildsFromMarkers(testDb.db, {
      migrationsDir: markerDir,
      appliedIds: ["0001_add_counts"],
    });
    expect(queued).toEqual(["read_pending_counts"]);

    failApply = true;
    const firstRun = await runPendingRebuilds(testDb.db, registry);
    expect(firstRun.failed).toEqual([
      {
        projection: "pendingtest:projection:pending-counts",
        error: expect.stringContaining("transient rebuild failure"),
      },
    ]);
    // Der Kern von studio#36: die Tabelle bleibt pending.
    expect(await listPendingRebuilds(testDb.db)).toEqual(["read_pending_counts"]);

    // Re-Run OHNE neue applied-Migrations (appliedIds leer = "alles war
    // schon applied") — die Queue alleine treibt den Nachhol-Rebuild.
    failApply = false;
    const secondRun = await runPendingRebuilds(testDb.db, registry);
    expect(secondRun.failed).toEqual([]);
    expect(secondRun.rebuilt).toEqual([
      { projection: "pendingtest:projection:pending-counts", eventsProcessed: 2 },
    ]);
    expect(await listPendingRebuilds(testDb.db)).toEqual([]);
    expect(await getCount()).toBe(2);
  });

  test("tables without a registered projection are drained, not stuck forever", async () => {
    writeRebuildMarker(markerDir, "0002_unmapped.sql", ["read_some_plain_table"]);
    await queueRebuildsFromMarkers(testDb.db, {
      migrationsDir: markerDir,
      appliedIds: ["0002_unmapped"],
    });

    const run = await runPendingRebuilds(testDb.db, registry);
    expect(run.unmapped).toEqual(["read_some_plain_table"]);
    expect(run.failed).toEqual([]);
    expect(await listPendingRebuilds(testDb.db)).toEqual([]);
  });

  test("clear is scoped to the snapshot migration_id — a concurrent re-queue survives (#328)", async () => {
    // Snapshot read: table queued for migration 0001.
    writeRebuildMarker(markerDir, "0001_counts.sql", ["read_pending_counts"]);
    await queueRebuildsFromMarkers(testDb.db, {
      migrationsDir: markerDir,
      appliedIds: ["0001_counts"],
    });
    const snapshot = await listPendingRebuildRows(testDb.db);
    expect(snapshot).toEqual([{ tableName: "read_pending_counts", migrationId: "0001_counts" }]);

    // A concurrent apply re-queues the SAME table for a NEWER migration between
    // the snapshot read and the clear (upsert bumps migration_id, keeps the slot).
    writeRebuildMarker(markerDir, "0002_counts.sql", ["read_pending_counts"]);
    await queueRebuildsFromMarkers(testDb.db, {
      migrationsDir: markerDir,
      appliedIds: ["0002_counts"],
    });

    // Clearing against the OLD snapshot must NOT drop the freshly re-queued entry.
    await clearPendingRebuilds(testDb.db, snapshot);
    expect(await listPendingRebuilds(testDb.db)).toEqual(["read_pending_counts"]);
    expect(await listPendingRebuildRows(testDb.db)).toEqual([
      { tableName: "read_pending_counts", migrationId: "0002_counts" },
    ]);

    // Clearing against the CURRENT snapshot does drain it.
    await clearPendingRebuilds(testDb.db, await listPendingRebuildRows(testDb.db));
    expect(await listPendingRebuilds(testDb.db)).toEqual([]);
  });

  test("no markers, no queue → noop", async () => {
    const run = await runPendingRebuilds(testDb.db, registry);
    expect(run).toEqual({ rebuilt: [], failed: [], unmapped: [], unresolvedManaged: [] });
  });

  // #361: eine managed-Tabelle (Marker tragen nur managed), die in DIESEM Run
  // geleert wurde, aber keine Projektion auflöst = owning-Feature fehlt in der
  // Komposition → laut (unresolvedManaged), aber non-fatal (gedraint, kein Throw).
  test("managed table emptied THIS run with no resolving projection → unresolvedManaged, still drained", async () => {
    writeRebuildMarker(markerDir, "0003_orphan_managed.sql", ["read_orphan_projection"]);
    const queued = await queueRebuildsFromMarkers(testDb.db, {
      migrationsDir: markerDir,
      appliedIds: ["0003_orphan_managed"],
    });
    expect(queued).toEqual(["read_orphan_projection"]);

    const run = await runPendingRebuilds(testDb.db, registry, { thisRunTables: queued });
    expect(run.unresolvedManaged).toEqual(["read_orphan_projection"]);
    expect(run.unmapped).toEqual([]);
    expect(run.rebuilt).toEqual([]);
    expect(run.failed).toEqual([]);
    // Trotz laut: gedraint → kein sticky-stuck Re-Apply.
    expect(await listPendingRebuilds(testDb.db)).toEqual([]);
  });

  // #361: dieselbe unmapped-Tabelle, aber NICHT in thisRunTables (pre-existing
  // pending aus einem früheren Run / evtl. altem unmanaged-Marker) → benign,
  // still gedraint, NICHT als unresolvedManaged geflaggt (kein False-Positive).
  test("pre-existing pending table not in thisRunTables → benign unmapped, not flagged", async () => {
    writeRebuildMarker(markerDir, "0004_legacy.sql", ["read_legacy_table"]);
    await queueRebuildsFromMarkers(testDb.db, {
      migrationsDir: markerDir,
      appliedIds: ["0004_legacy"],
    });

    // Re-Run ohne frisch gequeuete Tabellen (thisRunTables leer) — die Queue
    // trägt nur den Altbestand.
    const run = await runPendingRebuilds(testDb.db, registry, { thisRunTables: [] });
    expect(run.unmapped).toEqual(["read_legacy_table"]);
    expect(run.unresolvedManaged).toEqual([]);
    expect(await listPendingRebuilds(testDb.db)).toEqual([]);
  });

  // #361: ein lauter unresolved-managed-Eintrag darf den auflösbaren Rebuild
  // im selben Run nicht blockieren.
  test("mixed run: resolvable projection rebuilt while an unresolved managed table is flagged", async () => {
    await executor.create({ groupId: GROUP, name: "a" }, admin, tdb);
    writeRebuildMarker(markerDir, "0005_mixed.sql", [
      "read_pending_counts",
      "read_orphan_projection",
    ]);
    const queued = await queueRebuildsFromMarkers(testDb.db, {
      migrationsDir: markerDir,
      appliedIds: ["0005_mixed"],
    });

    const run = await runPendingRebuilds(testDb.db, registry, { thisRunTables: queued });
    expect(run.rebuilt).toEqual([
      { projection: "pendingtest:projection:pending-counts", eventsProcessed: 1 },
    ]);
    expect(run.unresolvedManaged).toEqual(["read_orphan_projection"]);
    expect(run.failed).toEqual([]);
    expect(await listPendingRebuilds(testDb.db)).toEqual([]);
    expect(await getCount()).toBe(1);
  });
});

// #362: der framework-Helper. Ohne jobs-Feature (kein jobRunner) rebuildet er
// synchron inline — das heutige Verhalten, garantiert framework-pur. Der
// dispatch-Pfad (mit jobs) lebt in jobs/__tests__/projection-rebuild-job.*.
describe("enqueueProjectionRebuild — inline fallback (no jobs feature)", () => {
  test("without a jobRunner, rebuilds the projection synchronously", async () => {
    await executor.create({ groupId: GROUP, name: "a" }, admin, tdb);
    await executor.create({ groupId: GROUP, name: "b" }, admin, tdb);

    const outcome = await enqueueProjectionRebuild("pendingtest:projection:pending-counts", {
      db: testDb.db,
      registry,
    });

    expect(outcome.mode).toBe("inline");
    if (outcome.mode === "inline") {
      expect(outcome.result.eventsProcessed).toBe(2);
    }
    expect(await getCount()).toBe(2);
  });
});

// #391/2: jobRunner present but the projection-rebuild job not registered (a
// caller that wired a jobRunner yet forgot to compose createJobsFeature()). The
// getJob-capability guard must still fall to the inline rebuild — NOT dispatch
// onto a runner whose queue has no handler for the job (silent no-op forever).
describe("enqueueProjectionRebuild — inline fallback (jobRunner without the job)", () => {
  test("jobRunner present but job unregistered → inline, dispatch never called", async () => {
    await executor.create({ groupId: GROUP, name: "a" }, admin, tdb);
    await executor.create({ groupId: GROUP, name: "b" }, admin, tdb);
    await executor.create({ groupId: GROUP, name: "c" }, admin, tdb);

    // Sanity: this registry has no projection-rebuild job (no jobs feature).
    expect(registry.getJob(PROJECTION_REBUILD_JOB)).toBeUndefined();

    let dispatchCalls = 0;
    const stubJobRunner: JobRunner = {
      start: async () => {},
      stop: async () => {},
      handleEvent: async () => {},
      dispatch: async () => {
        dispatchCalls++;
        return "should-not-happen";
      },
    };

    const outcome = await enqueueProjectionRebuild("pendingtest:projection:pending-counts", {
      db: testDb.db,
      registry,
      jobRunner: stubJobRunner,
    });

    expect(outcome.mode).toBe("inline");
    if (outcome.mode === "inline") {
      expect(outcome.result.eventsProcessed).toBe(3);
    }
    expect(dispatchCalls).toBe(0); // routed to inline, not to a handler-less queue
    expect(await getCount()).toBe(3);
  });
});
