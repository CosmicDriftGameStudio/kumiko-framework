import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { asRawClient, deleteMany, insertOne, selectMany, updateMany } from "../../bun-db/query";
import { createBooleanField, createEntity, createTextField } from "../../engine";
import {
  createTestDb,
  type TestDb,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "../../stack";
import { table as pgTable, serial, text, timestamp } from "../dialect";
import { buildDrizzleTable } from "../table-builder";
import { createTenantDb } from "../tenant-db";

// --- Entity table (has tenantId via buildBaseColumns) ---

const entity = createEntity({
  table: "tenant_db_items",
  fields: {
    name: createTextField({ required: true }),
    status: createTextField({ default: "draft" }),
    isActive: createBooleanField({ default: true }),
  },
  softDelete: true,
});

const table = buildDrizzleTable("tenantDbItem", entity);

// --- System table (no tenantId — like job_runs) ---

const systemTable = pgTable("tdb_system_entries", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

let testDb: TestDb;
const tenant1 = TestUsers.admin; // tenantId: 1
const tenant2 = TestUsers.otherTenant; // tenantId: 2

beforeAll(async () => {
  testDb = await createTestDb();
  await unsafeCreateEntityTable(testDb.db, entity, "tenantDbItem");
  await unsafePushTables(testDb.db, { tdb_system_entries: systemTable });
});

afterAll(async () => {
  await testDb.cleanup();
});

// =============================================================================
// MODE 1: Scoped (default) — tenant filter on reads, tenantId forced on insert
// =============================================================================

describe("scoped mode (default)", () => {
  describe("insert", () => {
    test("auto-injects tenantId into values", async () => {
      const tdb = createTenantDb(testDb.db, tenant1.tenantId);

      const rows = await insertOne(tdb, table, { name: "Item 1" });
      expect(rows[0]?.["tenantId"]).toBe(testTenantId(1));
      expect(rows[0]?.["name"]).toBe("Item 1");
    });

    test("cannot override tenantId via values", async () => {
      const tdb = createTenantDb(testDb.db, tenant1.tenantId);

      const rows = await insertOne(tdb, table, { name: "Sneaky", tenantId: testTenantId(999) });
      expect(rows[0]?.["tenantId"]).toBe(testTenantId(1));
    });
  });

  describe("select", () => {
    test("only returns rows for own tenant", async () => {
      const tdb1 = createTenantDb(testDb.db, tenant1.tenantId);
      const tdb2 = createTenantDb(testDb.db, tenant2.tenantId);

      await tdb1.insertOne(table, { name: "T1 Scoped" });
      await tdb2.insertOne(table, { name: "T2 Scoped" });

      const rows1 = await tdb1.selectMany(table);
      const rows2 = await tdb2.selectMany(table);

      expect(rows1.every((r) => r!["tenantId"] === testTenantId(1))).toBe(true);
      expect(rows2.every((r) => r!["tenantId"] === testTenantId(2))).toBe(true);
    });

    test("additional where conditions combine with tenant filter", async () => {
      const tdb = createTenantDb(testDb.db, tenant1.tenantId);

      await insertOne(tdb, table, { name: "findme", status: "active" });
      await insertOne(tdb, table, { name: "notme", status: "draft" });

      const rows = await selectMany(tdb, table, { status: "active" });

      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(
        rows.every((r) => r!["tenantId"] === testTenantId(1) && r!["status"] === "active"),
      ).toBe(true);
    });

    test("select with columns", async () => {
      const tdb = createTenantDb(testDb.db, tenant1.tenantId);

      await insertOne(tdb, table, { name: "ColSelect" });

      const rows = await asRawClient(tdb).unsafe<Record<string, unknown>>(
        `SELECT id, name FROM "tenant_db_items" WHERE name = $1 LIMIT 10`,
        ["ColSelect"],
      );

      expect(rows.length).toBeGreaterThanOrEqual(1);
      const row = rows[0]!;
      expect(row["name"]).toBe("ColSelect");
      expect(row["id"]).toBeDefined();
      expect(row["status"]).toBeUndefined();
    });

    test("select with limit", async () => {
      const tdb = createTenantDb(testDb.db, tenant1.tenantId);

      for (let i = 0; i < 5; i++) {
        await insertOne(tdb, table, { name: `Limit${i}` });
      }

      const rows = await selectMany(tdb, table, { limit: 2 });
      expect(rows).toHaveLength(2);
    });
  });

  describe("update", () => {
    test("only updates rows for own tenant", async () => {
      const tdb1 = createTenantDb(testDb.db, tenant1.tenantId);
      const tdb2 = createTenantDb(testDb.db, tenant2.tenantId);

      const row = await tdb1.insertOne(table, { name: "T1 Update" });
      const id = row!["id"] as string;

      const result = await tdb2.updateMany(table, { name: "Hacked" }, { id: id });

      expect(result).toHaveLength(0);

      const [updated] = await tdb1.updateMany(table, { name: "Updated" }, { id: id });

      expect(updated!["name"]).toBe("Updated");
    });

    test("update without returning", async () => {
      const tdb = createTenantDb(testDb.db, tenant1.tenantId);

      const row = await insertOne(tdb, table, { name: "NoReturn" });
      const id = row!["id"] as string;

      await updateMany(tdb, table, { name: "NoReturnUpdated" }, { id: id });

      const [updated] = await selectMany(tdb, table, { id: id });
      expect(updated!["name"]).toBe("NoReturnUpdated");
    });
  });

  describe("delete", () => {
    test("only deletes rows for own tenant", async () => {
      const tdb1 = createTenantDb(testDb.db, tenant1.tenantId);
      const tdb2 = createTenantDb(testDb.db, tenant2.tenantId);

      const row = await tdb1.insertOne(table, { name: "T1 Delete" });
      const id = row!["id"] as string;

      await tdb2.deleteMany(table, { id: id });

      const rows = await tdb1.selectMany(table, { id: id });
      expect(rows).toHaveLength(1);
    });
  });

  describe("cross-tenant isolation", () => {
    test("tenant cannot see, update, or delete other tenant data", async () => {
      const tdb1 = createTenantDb(testDb.db, tenant1.tenantId);
      const tdb2 = createTenantDb(testDb.db, tenant2.tenantId);

      const created = await tdb1.insertOne(table, { name: "Secret" });
      const id = created!["id"] as string;

      const seen = await tdb2.selectMany(table, { id: id });
      expect(seen).toHaveLength(0);

      const updated = await tdb2.updateMany(table, { name: "Hacked" }, { id: id });
      expect(updated).toHaveLength(0);

      await tdb2.deleteMany(table, { id: id });
      const stillThere = await tdb1.selectMany(table, { id: id });
      expect(stillThere).toHaveLength(1);
    });
  });

  describe("reference data (tenantId = 0)", () => {
    test("scoped select includes rows with tenantId = 0", async () => {
      // Seed reference data with tenantId = 0 (like seedReferenceData does)
      await insertOne(testDb.db, table, {
        name: "GlobalRef",
        status: "ref",
        tenantId: "00000000-0000-4000-8000-000000000000",
        version: 1,
        insertedAt: Temporal.Now.instant(),
      });

      const tdb1 = createTenantDb(testDb.db, tenant1.tenantId);
      const tdb2 = createTenantDb(testDb.db, tenant2.tenantId);

      // Both tenants can see the global reference row
      const rows1 = await tdb1.selectMany(table, { name: "GlobalRef" });
      expect(rows1).toHaveLength(1);

      const rows2 = await tdb2.selectMany(table, { name: "GlobalRef" });
      expect(rows2).toHaveLength(1);
    });

    test("scoped update does NOT affect tenantId = 0 rows", async () => {
      await insertOne(testDb.db, table, {
        name: "RefNoUpdate",
        status: "ref",
        tenantId: "00000000-0000-4000-8000-000000000000",
        version: 1,
        insertedAt: Temporal.Now.instant(),
      });

      const tdb1 = createTenantDb(testDb.db, tenant1.tenantId);

      const result = await tdb1.updateMany(table, { name: "Hacked" }, { name: "RefNoUpdate" });

      // Writes from a tenant scope must never touch reference rows (tenantId = 0).
      // Reading them is fine, modifying them is a cross-tenant integrity bug.
      expect(result).toHaveLength(0);

      const [untouched] = await selectMany(testDb.db, table, { name: "RefNoUpdate" });
      expect(untouched!["name"]).toBe("RefNoUpdate");
    });

    test("scoped delete does NOT affect tenantId = 0 rows", async () => {
      await insertOne(testDb.db, table, {
        name: "RefNoDelete",
        status: "ref",
        tenantId: "00000000-0000-4000-8000-000000000000",
        version: 1,
        insertedAt: Temporal.Now.instant(),
      });

      const tdb1 = createTenantDb(testDb.db, tenant1.tenantId);
      await tdb1.deleteMany(table, { name: "RefNoDelete" });

      const [stillThere] = await selectMany(testDb.db, table, { name: "RefNoDelete" });
      expect(stillThere).toBeDefined();
    });
  });
});

// =============================================================================
// MODE 2: System (r.systemScope()) — no tenant filter, tenantId as default
// =============================================================================

describe("system mode (r.systemScope())", () => {
  test("select returns rows from ALL tenants", async () => {
    const scoped1 = createTenantDb(testDb.db, tenant1.tenantId);
    const scoped2 = createTenantDb(testDb.db, tenant2.tenantId);

    await scoped1.insertOne(table, { name: "System-T1" });
    await scoped2.insertOne(table, { name: "System-T2" });

    const systemDb = createTenantDb(testDb.db, tenant1.tenantId, "system");
    const rows = await systemDb.selectMany(table);

    const tenantIds = new Set(rows.map((r) => r!["tenantId"]));
    // Must see rows from at least 2 different tenants
    expect(tenantIds.size).toBeGreaterThanOrEqual(2);
  });

  test("insert uses tenantId as default but handler can override", async () => {
    const systemDb = createTenantDb(testDb.db, tenant1.tenantId, "system");

    // Without explicit tenantId — uses the default (tenant1)
    const defaultRow = await systemDb.insertOne(table, { name: "SystemDefault" });
    expect(defaultRow!["tenantId"]).toBe(testTenantId(1));

    // With explicit tenantId — handler's value wins
    const overrideRow = await systemDb.insertOne(table, {
      name: "SystemOverride",
      tenantId: testTenantId(99),
    });
    expect(overrideRow!["tenantId"]).toBe(testTenantId(99));
  });

  test("insert with tenantId null (system config pattern)", async () => {
    // Config feature sets tenantId = null for system-scoped values
    // This requires the column to allow NULL — using systemTable which has no tenantId col,
    // but we can test the spread order logic directly:
    const systemDb = createTenantDb(testDb.db, tenant1.tenantId, "system");

    // In scoped mode, tenantId: 77 would be overridden to 1
    const scopedDb = createTenantDb(testDb.db, tenant1.tenantId);
    const scopedRow = await scopedDb.insertOne(table, {
      name: "ScopedForce",
      tenantId: testTenantId(77),
    });
    expect(scopedRow!["tenantId"]).toBe(testTenantId(1)); // forced

    // In unscoped mode, explicit tenantId wins
    const unscopedRow = await systemDb.insertOne(table, {
      name: "SystemExplicit",
      tenantId: testTenantId(77),
    });
    expect(unscopedRow!["tenantId"]).toBe(testTenantId(77)); // handler wins
  });

  test("update affects rows from any tenant", async () => {
    const scoped2 = createTenantDb(testDb.db, tenant2.tenantId);
    const row = await scoped2.insertOne(table, { name: "T2-System-Upd" });
    const id = row!["id"] as string;

    // Scoped tenant 1 cannot update tenant 2's row
    const scoped1 = createTenantDb(testDb.db, tenant1.tenantId);
    const scopedResult = await scoped1.updateMany(table, { name: "ScopedFail" }, { id: id });
    expect(scopedResult).toHaveLength(0);

    // Unscoped CAN update tenant 2's row
    const systemDb = createTenantDb(testDb.db, tenant1.tenantId, "system");
    const updated = await systemDb.updateMany(table, { name: "SystemWin" }, { id: id });
    expect(updated[0]!["name"]).toBe("SystemWin");
  });

  test("delete affects rows from any tenant", async () => {
    const scoped2 = createTenantDb(testDb.db, tenant2.tenantId);
    const row = await scoped2.insertOne(table, { name: "T2-System-Del" });
    const id = row!["id"] as string;

    // Unscoped can delete tenant 2's row from tenant 1 context
    const systemDb = createTenantDb(testDb.db, tenant1.tenantId, "system");
    await systemDb.deleteMany(table, { id: id });

    // Verify it's gone
    const remaining = await scoped2.selectMany(table, { id: id });
    expect(remaining).toHaveLength(0);
  });
});

// =============================================================================
// MODE 3: Tables without tenantId column — no filter, no injection
// =============================================================================

describe("tables without tenantId column", () => {
  test("select returns all rows (no tenant filter)", async () => {
    // Insert two rows via raw db
    await insertOne(testDb.db, systemTable, { label: "System-A" });
    await insertOne(testDb.db, systemTable, { label: "System-B" });

    const tdb = createTenantDb(testDb.db, tenant1.tenantId);
    const rows = await selectMany(tdb, systemTable);
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  test("insert does not inject tenantId", async () => {
    const tdb = createTenantDb(testDb.db, tenant1.tenantId);

    const row = await insertOne(tdb, systemTable, { label: "NoTenantInjection" });
    const data = row!;
    expect(data["label"]).toBe("NoTenantInjection");
    // No tenantId column at all — should not be in the result
    expect(data["tenantId"]).toBeUndefined();
  });

  test("select with where works without tenant filter", async () => {
    const tdb = createTenantDb(testDb.db, tenant1.tenantId);

    await insertOne(tdb, systemTable, { label: "FindThis" });

    const rows = await selectMany(tdb, systemTable, { label: "FindThis" });
    expect(rows).toHaveLength(1);
  });

  test("update works without tenant filter", async () => {
    const tdb = createTenantDb(testDb.db, tenant1.tenantId);

    const row = await insertOne(tdb, systemTable, { label: "BeforeUpd" });
    const id = row!["id"] as number;

    await updateMany(tdb, systemTable, { label: "AfterUpd" }, { id: id });

    const [updated] = await selectMany(tdb, systemTable, { id: id });
    expect(updated!["label"]).toBe("AfterUpd");
  });

  test("delete works without tenant filter", async () => {
    const tdb = createTenantDb(testDb.db, tenant1.tenantId);

    const row = await insertOne(tdb, systemTable, { label: "ToDelete" });
    const id = row!["id"] as number;

    await deleteMany(tdb, systemTable, { id: id });

    const remaining = await selectMany(tdb, systemTable, { id: id });
    expect(remaining).toHaveLength(0);
  });
});

// =============================================================================
// Misc
// =============================================================================

describe("tenantId property", () => {
  test("exposes tenantId for use in cursor queries etc.", () => {
    const tdb = createTenantDb(testDb.db, testTenantId(42));
    expect(tdb.tenantId).toBe(testTenantId(42));
  });
});

// =============================================================================
// Mass-update guard — update().set() without .where() must refuse.
// =============================================================================
//
// Rationale: without the guard, a handler that forgets the WHERE clause would
// overwrite every row for the current tenant. Drizzle itself doesn't flag this
// (plain SQL behaviour); TenantDb is the layer where we can notice and stop it.

describe("mass-update guard", () => {
  test(".set().returning() without .where() rejects with a clear error", async () => {
    const tdb = createTenantDb(testDb.db, tenant1.tenantId);
    await insertOne(tdb, table, { name: "MassUpdateVictim1" });
    await insertOne(tdb, table, { name: "MassUpdateVictim2" });

    await expect((tdb as any).updateMany(table, { name: "Wiped" })).rejects.toThrow(
      /without \.where\(\) would mass-update/,
    );

    // Rows must be untouched — the rejection happened before any SQL ran.
    const untouched = await selectMany(tdb, table);
    const touched = untouched.filter((r) => r["name"] === "Wiped");
    expect(touched).toHaveLength(0);
  });

  test(".set() awaited without .where() rejects too", async () => {
    const tdb = createTenantDb(testDb.db, tenant1.tenantId);
    await insertOne(tdb, table, { name: "AwaitGuardVictim" });

    const promise = (tdb as any).updateMany(table, {
      name: "WipedByAwait",
    }) as unknown as Promise<void>;
    await expect(promise).rejects.toThrow(/awaited without \.where\(\) would mass-update/);

    const untouched = await selectMany(tdb, table);
    const touched = untouched.filter((r) => r["name"] === "WipedByAwait");
    expect(touched).toHaveLength(0);
  });

  test(".set().where(...).returning() still works (guard only triggers on missing where)", async () => {
    const tdb = createTenantDb(testDb.db, tenant1.tenantId);
    const row = await insertOne(tdb, table, { name: "HappyPath" });
    const id = row!["id"] as string;

    const updated = await updateMany(tdb, table, { name: "HappyPathUpdated" }, { id: id });
    expect(updated[0]!["name"]).toBe("HappyPathUpdated");
  });
});

describe("pre-flight signal cancellation", () => {
  test("aborted signal: select throws AbortError before SQL is issued", async () => {
    const controller = new AbortController();
    controller.abort();
    const tdb = createTenantDb(
      testDb.db,
      tenant1.tenantId,
      "tenant",
      undefined,
      undefined,
      controller.signal,
    );

    let thrown: unknown;
    try {
      await selectMany(tdb, table);
    } catch (e) {
      thrown = e;
    }
    expect((thrown as Error).name).toBe("AbortError");
  });

  test("aborted signal: insert/update/delete all throw AbortError", async () => {
    const controller = new AbortController();
    controller.abort();
    const tdb = createTenantDb(
      testDb.db,
      tenant1.tenantId,
      "tenant",
      undefined,
      undefined,
      controller.signal,
    );

    let insertThrown: unknown;
    try {
      await insertOne(tdb, table, { name: "x" });
    } catch (e) {
      insertThrown = e;
    }
    expect((insertThrown as Error).name).toBe("AbortError");

    let updateThrown: unknown;
    try {
      await updateMany(tdb, table, { name: "y" }, { id: "00000000-0000-0000-0000-000000000001" });
    } catch (e) {
      updateThrown = e;
    }
    expect((updateThrown as Error).name).toBe("AbortError");

    let deleteThrown: unknown;
    try {
      await deleteMany(tdb, table, { id: "00000000-0000-0000-0000-000000000001" });
    } catch (e) {
      deleteThrown = e;
    }
    expect((deleteThrown as Error).name).toBe("AbortError");
  });

  test("mid-chain abort: first query succeeds, abort, next query throws", async () => {
    // Simulates a handler doing N sequential queries where the client
    // disconnects after query 1. Without the pre-flight check, queries
    // 2..N would all execute and waste DB-CPU. With it, the chain stops
    // immediately.
    const controller = new AbortController();
    const tdb = createTenantDb(
      testDb.db,
      tenant1.tenantId,
      "tenant",
      undefined,
      undefined,
      controller.signal,
    );

    const first = await insertOne(tdb, table, { name: "preflight-first" });
    expect(first).toBeDefined();

    controller.abort();

    let secondThrown: unknown;
    try {
      await insertOne(tdb, table, { name: "preflight-second" });
    } catch (e) {
      secondThrown = e;
    }
    expect((secondThrown as Error).name).toBe("AbortError");

    // Proves the first row was actually committed and the second never
    // made it — the abort prevented future work, didn't roll back done
    // work.
    const rows = await selectMany(testDb.db, table);
    const names = rows.map((r) => r["name"] as string);
    expect(names).toContain("preflight-first");
    expect(names).not.toContain("preflight-second");
  });

  test("no signal passed: queries run normally (signal is opt-in)", async () => {
    const tdb = createTenantDb(testDb.db, tenant1.tenantId);
    const result = await insertOne(tdb, table, { name: "no-signal" });
    expect(result).toHaveLength(1);
  });
});
