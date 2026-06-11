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
import {
  listPendingRebuilds,
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

  test("no markers, no queue → noop", async () => {
    const run = await runPendingRebuilds(testDb.db, registry);
    expect(run).toEqual({ rebuilt: [], failed: [], unmapped: [] });
  });
});
