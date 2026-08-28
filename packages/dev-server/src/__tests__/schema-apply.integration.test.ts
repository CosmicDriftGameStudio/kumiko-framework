// Production-Behavior von `kumiko schema apply` (runSchemaApply): der
// migrate-initContainer ruft das gegen eine frische CNPG-DB. Der riskante,
// neue Teil gegenüber dem alten per-App-Boilerplate ist der Greenfield-
// Bootstrap — Infra-Tabellen (event-store + pipeline-state) MÜSSEN vor den
// App-Migrations idempotent angelegt werden, sonst bricht eine leere DB an
// `relation "kumiko_events" does not exist`. Dieser Test fährt den echten
// Pfad gegen eine leere DB + den idempotenten Re-Run.

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  asRawClient,
  buildEntityTable,
  createDbConnection,
  createEventStoreExecutor,
  createTenantDb,
  type DbConnection,
  integer,
  table as pgTable,
  selectMany,
  tableExists,
  uuid,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createTextField,
  defineApply,
  defineFeature,
  type ProjectionDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestDb,
  type TestDb,
  TestUsers,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { runSchemaApply } from "../schema-apply";

let testDb: TestDb;
let conn: { readonly db: DbConnection; readonly close: () => Promise<void> };
let appCwd: string;
let migDir: string;
const savedDbUrl = process.env["DATABASE_URL"];

const APPLY = { features: [], includeBundled: false } as const;

beforeAll(async () => {
  const base = process.env["TEST_DATABASE_URL"];
  if (!base) throw new Error("TEST_DATABASE_URL required for schema-apply integration test");

  testDb = await createTestDb();
  const testUrl = base.replace(/\/[^/]+$/, `/${testDb.dbName}`);
  process.env["DATABASE_URL"] = testUrl;
  conn = createDbConnection(testUrl);

  // Greenfield erzwingen: createTestDb legt kumiko_events bereits an —
  // wegdroppen, damit runSchemaApply den Infra-Bootstrap echt durchläuft.
  const raw = asRawClient(conn.db);
  await raw.unsafe(`DROP TABLE IF EXISTS "kumiko_events" CASCADE`);
  await raw.unsafe(`DROP TABLE IF EXISTS "kumiko_event_consumers" CASCADE`);
  await raw.unsafe(`DROP TABLE IF EXISTS "kumiko_projections" CASCADE`);
  await raw.unsafe(`DROP TABLE IF EXISTS "_kumiko_migrations" CASCADE`);

  appCwd = mkdtempSync(join(tmpdir(), "kumiko-schema-apply-"));
  migDir = join(appCwd, "kumiko", "migrations");
  mkdirSync(migDir, { recursive: true });
  writeFileSync(
    join(migDir, "0001_init.sql"),
    `CREATE TABLE "read_thing" ("id" text PRIMARY KEY);`,
  );
});

afterAll(async () => {
  await conn?.close();
  await testDb?.cleanup();
  if (appCwd) rmSync(appCwd, { recursive: true, force: true });
  if (savedDbUrl === undefined) delete process.env["DATABASE_URL"];
  else process.env["DATABASE_URL"] = savedDbUrl;
});

describe("runSchemaApply", () => {
  test("Greenfield: leere DB → Infra-Tabellen + App-Migration appliziert → 0", async () => {
    expect(await runSchemaApply({ ...APPLY, appCwd })).toBe(0);

    expect(await tableExists(conn.db, "public.kumiko_events")).toBe(true);
    expect(await tableExists(conn.db, "public.kumiko_event_consumers")).toBe(true);
    expect(await tableExists(conn.db, "public.kumiko_projections")).toBe(true);
    expect(await tableExists(conn.db, "public.read_thing")).toBe(true);
  });

  test("Re-Run auf Bestands-DB ist idempotent → 0 (Infra no-op, Migrations skipped)", async () => {
    expect(await runSchemaApply({ ...APPLY, appCwd })).toBe(0);
    expect(await tableExists(conn.db, "public.read_thing")).toBe(true);
  });

  test("rebuild-Marker für nicht-registrierte Tabelle → kein Crash, 0, aber laut warnen (522/3, #2464)", async () => {
    writeFileSync(
      join(migDir, "0002_more.sql"),
      `CREATE TABLE "read_more" ("id" text PRIMARY KEY);`,
    );
    writeFileSync(
      join(migDir, "0002_more.rebuild.json"),
      JSON.stringify({ version: 1, tables: ["read_more"] }),
    );

    // runPendingRebuilds (not the old local helper) owns this warning now —
    // it logs via createFallbackLogger(...).error(...), not console.warn.
    const error = spyOn(console, "error").mockImplementation(() => {});
    expect(await runSchemaApply({ ...APPLY, appCwd })).toBe(0);
    expect(await tableExists(conn.db, "public.read_more")).toBe(true);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("read_more"), expect.anything());
    error.mockRestore();
  });

  test("failed projection rebuild stays queued and is retried on a later apply with zero new migrations (#2464)", async () => {
    // Isolate from any pending-rebuild rows the earlier tests in this file left.
    await asRawClient(conn.db).unsafe(`DROP TABLE IF EXISTS kumiko_pending_rebuilds`);

    const groupId = "00000000-0000-4000-8000-0000000000b1";
    let failApply = true;

    const failItemEntity = createEntity({
      table: "read_apply_fail_items",
      fields: {
        groupId: createTextField({ required: true }),
        name: createTextField({ required: true }),
      },
    });
    const failItemTable = buildEntityTable("apply-fail-item", failItemEntity);
    const failCountsTable = pgTable("read_apply_fail_counts", {
      groupId: uuid("group_id").primaryKey(),
      tenantId: uuid("tenant_id").notNull(),
      itemCount: integer("item_count").notNull().default(0),
    });
    const failCountsProjection: ProjectionDefinition = {
      name: "apply-fail-counts",
      source: "apply-fail-item",
      table: failCountsTable,
      apply: {
        "apply-fail-item.created": defineApply<{ groupId: string }>(async (event, tx) => {
          if (failApply) throw new Error("simulated rebuild failure (test)");
          await asRawClient(tx).unsafe(
            `INSERT INTO "read_apply_fail_counts" (group_id, tenant_id, item_count) VALUES ($1::uuid, $2::uuid, 1)
             ON CONFLICT (group_id) DO UPDATE SET item_count = read_apply_fail_counts.item_count + 1`,
            [event.payload.groupId, event.tenantId],
          );
        }),
      },
    };
    const feature = defineFeature("applyfailtest", (r) => {
      r.entity("apply-fail-item", failItemEntity);
      r.projection(failCountsProjection);
    });

    await unsafeCreateEntityTable(conn.db, failItemEntity, "apply-fail-item");
    await unsafePushTables(conn.db, { readApplyFailCounts: failCountsTable });

    const tdb = createTenantDb(conn.db, TestUsers.admin.tenantId);
    const executor = createEventStoreExecutor(failItemTable, failItemEntity, {
      entityName: "apply-fail-item",
    });
    await executor.create({ groupId, name: "x" }, TestUsers.admin, tdb);

    writeFileSync(join(migDir, "0003_touch_fail_counts.sql"), "SELECT 1;\n");
    writeFileSync(
      join(migDir, "0003_touch_fail_counts.rebuild.json"),
      JSON.stringify({ version: 1, tables: ["read_apply_fail_counts"] }),
    );

    const error = spyOn(console, "error").mockImplementation(() => {});
    const firstRun = await runSchemaApply({ features: [feature], includeBundled: false, appCwd });
    error.mockRestore();
    // Fail-loud: a failed rebuild must surface as a non-zero exit, not a
    // silent 0 — the migration itself is now tracked applied, so without a
    // persisted queue this table's rebuild would never be retried again.
    expect(firstRun).toBe(1);
    const [rowAfterFail] = await selectMany(conn.db, failCountsTable, { groupId });
    expect(rowAfterFail).toBeUndefined();

    // Second apply: no new migrations (0003 is already tracked), yet the
    // queued table must still be retried from kumiko_pending_rebuilds.
    failApply = false;
    const secondRun = await runSchemaApply({ features: [feature], includeBundled: false, appCwd });
    expect(secondRun).toBe(0);
    const [rowAfterRetry] = await selectMany(conn.db, failCountsTable, { groupId });
    expect(rowAfterRetry?.itemCount).toBe(1);
  });
});
