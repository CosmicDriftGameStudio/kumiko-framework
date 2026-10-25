// The boot check against real Postgres: role attributes plus the policy catalog decide whether "on" or "off" is safe to boot.

import { afterEach, describe, expect, test } from "bun:test";
import { createTestDb, type TestDb } from "@cosmicdrift/kumiko-testing/stack";
import { defineUnmanagedTable } from "../entity-table-meta.ts";
import type { KnownTables } from "../known-table-names.ts";
import { knownTablesOf } from "../known-table-names.ts";
import { asRawClient } from "../query.ts";
import { assertRowLevelSecurityBootState } from "../row-level-security-boot-check.ts";
import { unsafePushTables } from "../table-push.ts";

const tenantTable = defineUnmanagedTable({
  tableName: "store_boot_check_items",
  columns: [
    {
      name: "id",
      pgType: "uuid",
      notNull: true,
      primaryKey: true,
      defaultSql: "gen_random_uuid()",
    },
    { name: "tenant_id", pgType: "uuid", notNull: true },
  ],
});

const knowsEverything: KnownTables = { has: () => true };
const knowsNothing: KnownTables = { has: () => false };

const openDbs: TestDb[] = [];

async function openDb(applicationRole: boolean): Promise<TestDb> {
  const testDb = await createTestDb({ applicationRole });
  openDbs.push(testDb);
  return testDb;
}

// A push over an application-role pool renders the policies itself.
async function openAppDbWithTable(): Promise<TestDb> {
  const testDb = await openDb(true);
  await unsafePushTables(testDb.db, { items: tenantTable });
  return testDb;
}

afterEach(async () => {
  await Promise.all(openDbs.splice(0).map((testDb) => testDb.cleanup()));
});

describe("assertRowLevelSecurityBootState", () => {
  test('"on" over a superuser connection throws, naming the role attribute', async () => {
    const { db } = await openDb(false);
    await expect(assertRowLevelSecurityBootState(db, "on", knowsEverything)).rejects.toThrow(
      /SUPERUSER/,
    );
  });

  test('"on" with a table whose row-level security was switched off throws, naming table and parts', async () => {
    const { db } = await openAppDbWithTable();
    const raw = asRawClient(db);
    await raw.unsafe(`ALTER TABLE "store_boot_check_items" NO FORCE ROW LEVEL SECURITY`);
    await raw.unsafe(`ALTER TABLE "store_boot_check_items" DISABLE ROW LEVEL SECURITY`);
    await expect(assertRowLevelSecurityBootState(db, "on", knowsEverything)).rejects.toThrow(
      /store_boot_check_items \(ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY\)/,
    );
  });

  test('"on" with a dropped policy throws, naming the table and the policy', async () => {
    const { db } = await openAppDbWithTable();
    await asRawClient(db).unsafe(
      `DROP POLICY "kumiko_system_tenant_read" ON "store_boot_check_items"`,
    );
    await expect(assertRowLevelSecurityBootState(db, "on", knowsEverything)).rejects.toThrow(
      /store_boot_check_items \(policy kumiko_system_tenant_read\)/,
    );
  });

  test('"on" over the application role with every policy applied passes', async () => {
    const { db } = await openAppDbWithTable();
    await expect(
      assertRowLevelSecurityBootState(db, "on", knowsEverything),
    ).resolves.toBeUndefined();
  });

  test('"off" while a table still has live row-level security throws with the DISABLE hint', async () => {
    const { db } = await openAppDbWithTable();
    await expect(assertRowLevelSecurityBootState(db, "off", knowsEverything)).rejects.toThrow(
      /store_boot_check_items.*DISABLE ROW LEVEL SECURITY/s,
    );
  });

  test('"off" over a database without row-level security passes', async () => {
    const { db } = await openDb(false);
    await unsafePushTables(db, { items: tenantTable });
    await expect(
      assertRowLevelSecurityBootState(db, "off", knowsEverything),
    ).resolves.toBeUndefined();
  });

  async function openAppDbWithUnprotectedTable(): Promise<TestDb> {
    const testDb = await openAppDbWithTable();
    const raw = asRawClient(testDb.db);
    await raw.unsafe(`ALTER TABLE "store_boot_check_items" NO FORCE ROW LEVEL SECURITY`);
    await raw.unsafe(`ALTER TABLE "store_boot_check_items" DISABLE ROW LEVEL SECURITY`);
    return testDb;
  }

  test("a known table without protection points to schema generate", async () => {
    const { db } = await openAppDbWithUnprotectedTable();
    const error = await assertRowLevelSecurityBootState(db, "on", knowsEverything).catch(
      (e: Error) => e,
    );
    expect(String(error)).toMatch(/tables of this app without it: store_boot_check_items/);
    expect(String(error)).toContain("bun kumiko-schema generate");
    expect(String(error)).not.toContain("no feature declares");
  });

  test("an unknown tenant table is reported as orphaned with the DROP TABLE fix", async () => {
    const { db } = await openAppDbWithUnprotectedTable();
    const error = await assertRowLevelSecurityBootState(db, "on", knowsNothing).catch(
      (e: Error) => e,
    );
    expect(String(error)).toMatch(/no feature declares anymore: store_boot_check_items/);
    expect(String(error)).toContain("bun kumiko-schema status");
    expect(String(error)).not.toContain("tables of this app");
  });

  test("known and orphaned tables are listed in their own groups", async () => {
    const { db } = await openAppDbWithUnprotectedTable();
    await unsafePushTables(db, { orphan: { ...tenantTable, tableName: "read_orphan_items" } });
    const raw = asRawClient(db);
    await raw.unsafe(`ALTER TABLE "read_orphan_items" NO FORCE ROW LEVEL SECURITY`);
    await raw.unsafe(`ALTER TABLE "read_orphan_items" DISABLE ROW LEVEL SECURITY`);
    const onlyBootCheckItems: KnownTables = { has: (name) => name === "store_boot_check_items" };
    const message = String(
      await assertRowLevelSecurityBootState(db, "on", onlyBootCheckItems).catch((e: Error) => e),
    );
    expect(message).toMatch(/tables of this app without it: store_boot_check_items \([^)]*\)\./);
    expect(message).toMatch(/no feature declares anymore: read_orphan_items/);
  });

  test("a retired framework table is orphaned, a live kumiko_ table is known", () => {
    const known = knownTablesOf([]);
    expect(known.has("kumiko_events")).toBe(true);
    expect(known.has("read_job_runs")).toBe(false);
  });

  test("a retired framework table with tenant_id lands in the orphan group", async () => {
    const { db } = await openDb(true);
    await unsafePushTables(db, { retired: { ...tenantTable, tableName: "read_job_runs" } });
    const raw = asRawClient(db);
    await raw.unsafe(`ALTER TABLE "read_job_runs" NO FORCE ROW LEVEL SECURITY`);
    await raw.unsafe(`ALTER TABLE "read_job_runs" DISABLE ROW LEVEL SECURITY`);
    const message = String(
      await assertRowLevelSecurityBootState(db, "on", knownTablesOf([])).catch((e: Error) => e),
    );
    expect(message).toMatch(/no feature declares anymore: read_job_runs/);
  });
});
