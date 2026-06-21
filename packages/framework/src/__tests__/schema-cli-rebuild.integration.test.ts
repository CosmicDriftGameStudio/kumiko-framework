// `schema apply` rebuilds the projections a freshly applied migration touched —
// the projection-rebuild step the per-app bin/kumiko.ts files duplicate today,
// folded into runSchemaCli behind the optional `features` option.
//
// Honest wiring test: seed one event, apply a migration carrying a hand-written
// .rebuild.json marker, assert the projection was actually replayed (the row
// reconstructed from the event log — not just a log line).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeRebuildMarker } from "../db";
import { integer, table as pgTable, uuid } from "../db/dialect";
import { createEventStoreExecutor } from "../db/event-store-executor";
import { asRawClient, selectMany } from "../db/query";
import { buildEntityTable } from "../db/table-builder";
import { createTenantDb, type TenantDb } from "../db/tenant-db";
import { createEntity, createTextField, defineApply, defineFeature } from "../engine";
import type { ProjectionDefinition } from "../engine/types";
import { createEventsTable } from "../event-store";
import { createProjectionStateTable } from "../pipeline";
import { runSchemaCli, type SchemaCliOut } from "../schema-cli";
import {
  createTestDb,
  type TestDb,
  TestUsers,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "../stack";
import { ensureTemporalPolyfill } from "../time/polyfill";

const itemEntity = createEntity({
  table: "read_apply_items",
  fields: {
    groupId: createTextField({ required: true }),
    name: createTextField({ required: true }),
  },
  softDelete: true,
});
const itemTable = buildEntityTable("apply-item", itemEntity);

const COUNTER_TABLE = "read_apply_items_per_group";
const counterTable = pgTable(COUNTER_TABLE, {
  groupId: uuid("group_id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  itemCount: integer("item_count").notNull().default(0),
});

type ItemCreated = { groupId: string };
const counterProjection: ProjectionDefinition = {
  name: "items-per-group",
  source: "apply-item",
  table: counterTable,
  apply: {
    "apply-item.created": defineApply<ItemCreated>(async (event, tx) => {
      await asRawClient(tx).unsafe(
        `INSERT INTO "${COUNTER_TABLE}" (group_id, tenant_id, item_count) VALUES ($1::uuid, $2::uuid, 1) ON CONFLICT (group_id) DO UPDATE SET item_count = ${COUNTER_TABLE}.item_count + 1`,
        [event.payload.groupId, event.tenantId],
      );
    }),
  },
};

const feature = defineFeature("applyrebuildtest", (r) => {
  r.entity("apply-item", itemEntity);
  r.projection(counterProjection);
});

const admin = TestUsers.admin;
const executor = createEventStoreExecutor(itemTable, itemEntity, { entityName: "apply-item" });

function captureOut(): { out: SchemaCliOut; log: string[]; err: string[] } {
  const log: string[] = [];
  const err: string[] = [];
  return { out: { log: (l) => log.push(l), err: (l) => err.push(l) }, log, err };
}

// Writes an app workspace with a single trivial migration + an optional
// hand-written rebuild marker, bypassing the generate→managed-diff machinery
// (tested elsewhere) to exercise only the apply→marker→rebuild wiring.
function writeMigration(migrationId: string, rebuildTables: readonly string[] | null): string {
  const appCwd = join(
    tmpdir(),
    `kumiko-apply-rebuild-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  const migrationsDir = join(appCwd, "kumiko/migrations");
  mkdirSync(migrationsDir, { recursive: true });
  writeFileSync(join(migrationsDir, `${migrationId}.sql`), "SELECT 1;\n");
  if (rebuildTables) {
    writeRebuildMarker(migrationsDir, `${migrationId}.sql`, rebuildTables);
  }
  return appCwd;
}

let testDb: TestDb;
let tdb: TenantDb;
let prevDbUrl: string | undefined;

beforeAll(async () => {
  await ensureTemporalPolyfill();
  testDb = await createTestDb();
  await unsafeCreateEntityTable(testDb.db, itemEntity, "apply-item");
  await createEventsTable(testDb.db);
  await createProjectionStateTable(testDb.db);
  await unsafePushTables(testDb.db, { applyItemsPerGroup: counterTable });
  tdb = createTenantDb(testDb.db, admin.tenantId);
  prevDbUrl = process.env["DATABASE_URL"];
  const baseUrl =
    process.env["TEST_DATABASE_URL"] ??
    process.env["DATABASE_URL"] ??
    "postgresql://kumiko:kumiko@localhost:15432/kumiko_test";
  process.env["DATABASE_URL"] = baseUrl.replace(/\/[^/]+$/, `/${testDb.dbName}`);
});

afterAll(async () => {
  if (prevDbUrl !== undefined) process.env["DATABASE_URL"] = prevDbUrl;
  else delete process.env["DATABASE_URL"];
  await testDb?.cleanup();
});

beforeEach(async () => {
  await asRawClient(testDb.db).unsafe(
    `TRUNCATE kumiko_events, read_apply_items, ${COUNTER_TABLE}, kumiko_projections RESTART IDENTITY CASCADE`,
  );
});

async function counterFor(groupId: string): Promise<number | undefined> {
  const [row] = await selectMany(testDb.db, counterTable, { groupId });
  return row?.itemCount;
}

describe("runSchemaCli apply — projection rebuild", () => {
  const group = "00000000-0000-4000-8000-0000000000a1";

  test("with features: applied migration's marker triggers a real rebuild", async () => {
    await executor.create({ groupId: group, name: "x" }, admin, tdb);
    // Pipeline not wired on this append → projection is empty until rebuild.
    expect(await counterFor(group)).toBeUndefined();

    const appCwd = writeMigration("0001_touch_counter", [COUNTER_TABLE]);
    const cap = captureOut();
    const code = await runSchemaCli(["apply"], appCwd, cap.out, { features: [feature] });

    expect(code).toBe(0);
    expect(cap.log.join("\n")).toContain("Rebuild 1 Projection");
    expect(cap.log.join("\n")).toContain("(1 events");
    // The row was reconstructed from the seeded event — not a no-op loop.
    expect(await counterFor(group)).toBe(1);
  });

  test("without features: marker present but no rebuild (dev path)", async () => {
    await executor.create({ groupId: group, name: "x" }, admin, tdb);

    const appCwd = writeMigration("0002_touch_counter", [COUNTER_TABLE]);
    const cap = captureOut();
    const code = await runSchemaCli(["apply"], appCwd, cap.out);

    expect(code).toBe(0);
    expect(cap.log.join("\n")).not.toContain("Rebuild");
    // No rebuild ran → projection stays empty.
    expect(await counterFor(group)).toBeUndefined();
  });

  test("with features but no marker: apply succeeds, no rebuild", async () => {
    await executor.create({ groupId: group, name: "x" }, admin, tdb);

    const appCwd = writeMigration("0003_no_marker", null);
    const cap = captureOut();
    const code = await runSchemaCli(["apply"], appCwd, cap.out, { features: [feature] });

    expect(code).toBe(0);
    expect(cap.log.join("\n")).not.toContain("Rebuild");
    expect(await counterFor(group)).toBeUndefined();
  });

  // Marker zeigt auf eine Tabelle die KEINE registrierte Projektion hat →
  // projections.size === 0 → Early-Return vor dem Rebuild-Schritt (kein Throw,
  // exit 0). Bisher nur "kein Marker" und "keine Features" getestet.
  test("with features: marker for a table with no registered projection → no rebuild, exit 0", async () => {
    await executor.create({ groupId: group, name: "x" }, admin, tdb);

    const appCwd = writeMigration("0004_unknown_table", ["read_nonexistent_table"]);
    const cap = captureOut();
    const code = await runSchemaCli(["apply"], appCwd, cap.out, { features: [feature] });

    expect(code).toBe(0);
    expect(cap.log.join("\n")).not.toContain("Rebuild");
    expect(await counterFor(group)).toBeUndefined();
  });
});
