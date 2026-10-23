// The boot check against real Postgres: role attributes plus the policy catalog decide whether "on" or "off" is safe to boot.

import { afterEach, describe, expect, test } from "bun:test";
import { createTestDb, type TestDb } from "@cosmicdrift/kumiko-testing/stack";
import { defineUnmanagedTable } from "../entity-table-meta.ts";
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
    await expect(assertRowLevelSecurityBootState(db, "on")).rejects.toThrow(/SUPERUSER/);
  });

  test('"on" with a table whose row-level security was switched off throws, naming table and parts', async () => {
    const { db } = await openAppDbWithTable();
    const raw = asRawClient(db);
    await raw.unsafe(`ALTER TABLE "store_boot_check_items" NO FORCE ROW LEVEL SECURITY`);
    await raw.unsafe(`ALTER TABLE "store_boot_check_items" DISABLE ROW LEVEL SECURITY`);
    await expect(assertRowLevelSecurityBootState(db, "on")).rejects.toThrow(
      /store_boot_check_items \(ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY\)/,
    );
  });

  test('"on" with a dropped policy throws, naming the table and the policy', async () => {
    const { db } = await openAppDbWithTable();
    await asRawClient(db).unsafe(
      `DROP POLICY "kumiko_system_tenant_read" ON "store_boot_check_items"`,
    );
    await expect(assertRowLevelSecurityBootState(db, "on")).rejects.toThrow(
      /store_boot_check_items \(policy kumiko_system_tenant_read\)/,
    );
  });

  test('"on" over the application role with every policy applied passes', async () => {
    const { db } = await openAppDbWithTable();
    await expect(assertRowLevelSecurityBootState(db, "on")).resolves.toBeUndefined();
  });

  test('"off" while a table still has live row-level security throws with the DISABLE hint', async () => {
    const { db } = await openAppDbWithTable();
    await expect(assertRowLevelSecurityBootState(db, "off")).rejects.toThrow(
      /store_boot_check_items.*DISABLE ROW LEVEL SECURITY/s,
    );
  });

  test('"off" over a database without row-level security passes', async () => {
    const { db } = await openDb(false);
    await unsafePushTables(db, { items: tenantTable });
    await expect(assertRowLevelSecurityBootState(db, "off")).resolves.toBeUndefined();
  });
});
