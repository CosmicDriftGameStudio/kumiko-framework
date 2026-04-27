// Direkter Coverage für die Tier-2.6d-Erweiterung von executor.list:
// offset, totalCount, sowie das "cursor wins über offset" Verhalten.
// Vor dieser Suite waren die drei Branches nur indirekt über
// items-create.integration im Showcase abgedeckt — nicht ausreichend
// für Framework-Code der von jeder App genutzt wird.

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createEntity, createNumberField, createTextField } from "../../engine";
import { createEventsTable } from "../../event-store";
import { createEntityTable, createTestDb, type TestDb, TestUsers } from "../../testing";
import { createEventStoreExecutor } from "../event-store-executor";
import { buildDrizzleTable } from "../table-builder";
import { createTenantDb, type TenantDb } from "../tenant-db";

const entity = createEntity({
  table: "read_pager_items",
  fields: {
    title: createTextField({ required: true, sortable: true }),
    rank: createNumberField({ sortable: true }),
  },
});
const table = buildDrizzleTable("pagerItem", entity);

let testDb: TestDb;
let tdb: TenantDb;
const admin = TestUsers.admin;

beforeAll(async () => {
  testDb = await createTestDb();
  await createEntityTable(testDb.db, entity, "pagerItem");
  await createEventsTable(testDb.db);
  tdb = createTenantDb(testDb.db, admin.tenantId);
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await testDb.db.execute(sql`TRUNCATE kumiko_events, read_pager_items RESTART IDENTITY CASCADE`);
});

describe("event-store-executor.list — offset + totalCount (Tier 2.6d)", () => {
  const exec = createEventStoreExecutor(table, entity, { entityName: "pagerItem" });

  async function seed(n: number): Promise<void> {
    for (let i = 0; i < n; i++) {
      await exec.create({ title: `item-${String(i).padStart(3, "0")}`, rank: i }, admin, tdb);
    }
  }

  test("ohne totalCount: response hat KEIN total-Feld (extra COUNT gespart)", async () => {
    await seed(5);
    const res = await exec.list({ limit: 50 }, admin, tdb);
    expect(res.rows).toHaveLength(5);
    expect("total" in res).toBe(false);
  });

  test("mit totalCount=true: response hat total = N", async () => {
    await seed(7);
    const res = await exec.list({ limit: 50, totalCount: true }, admin, tdb);
    expect(res.rows).toHaveLength(7);
    expect(res.total).toBe(7);
  });

  test("offset paginiert deterministisch (sort=rank asc + offset=2 → rows 3-5)", async () => {
    await seed(10);
    const res = await exec.list(
      { limit: 3, offset: 2, sort: "rank", sortDirection: "asc", totalCount: true },
      admin,
      tdb,
    );
    expect(res.rows.map((r) => r["rank"])).toEqual([2, 3, 4]);
    expect(res.total).toBe(10);
  });

  test("offset >= total: leere rows, total bleibt korrekt", async () => {
    await seed(3);
    const res = await exec.list(
      { limit: 10, offset: 100, sort: "rank", sortDirection: "asc", totalCount: true },
      admin,
      tdb,
    );
    expect(res.rows).toHaveLength(0);
    expect(res.total).toBe(3);
  });

  test("cursor wins über offset (kombination ist Caller-bug, defensiv)", async () => {
    // Wenn der Caller versehentlich BEIDE setzt — z.B. ein Migrations-
    // Skript das Cursor-Pagination + Page-Number mischt — soll cursor
    // gewinnen weil DB-stable. Offset wird ignoriert.
    await seed(10);
    const first = await exec.list({ limit: 3, sort: "rank", sortDirection: "asc" }, admin, tdb);
    expect(first.rows.map((r) => r["rank"])).toEqual([0, 1, 2]);
    const cursor = first.nextCursor;
    expect(cursor).not.toBeNull();
    if (cursor === null) return;
    // cursor + offset:50 — cursor sollte gewinnen, nicht das offset.
    // Note: cursor-pagination hier ist NICHT row-3 → row-4-stable, weil
    // die UUIDs zwar UUIDv7 sind aber innerhalb derselben Millisekunde
    // generiert die Sub-Sort nicht garantiert mit `rank` korreliert. Wir
    // pinnen nur "cursor wird benutzt → kein offset:50-Skip auf row-50
    // (die's gar nicht gibt)".
    const next = await exec.list(
      { limit: 3, cursor, offset: 50, sort: "rank", sortDirection: "asc" },
      admin,
      tdb,
    );
    // Ohne cursor-wins-Branch wäre das offset=50 → leeres Result.
    // Mit cursor-wins läuft der gt(id, cursor)-Filter und liefert
    // rows die NACH dem cursor kommen → mindestens 1 Eintrag.
    expect(next.rows.length).toBeGreaterThan(0);
  });

  test("totalCount auf empty-result: total=0, rows=[]", async () => {
    const res = await exec.list({ limit: 50, totalCount: true }, admin, tdb);
    expect(res.rows).toHaveLength(0);
    expect(res.total).toBe(0);
  });
});
