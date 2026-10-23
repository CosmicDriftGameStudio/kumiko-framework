// Migrations rewrite every tenant's rows, so they must run system scoped even over the non-bypass application role.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestDb, type TestDb } from "@cosmicdrift/kumiko-testing/stack";
import { testTenantId } from "../../seeding/seed-users.ts";
import { defineUnmanagedTable } from "../entity-table-meta.ts";
import { type Migration, runMigrations } from "../migrate-runner.ts";
import { asRawClient } from "../query.ts";
import { rowLevelSecurityModeOf } from "../row-level-security-connection.ts";
import { runInSystemRowLevelSecurityScope } from "../row-level-security-scope.ts";
import { unsafePushTables } from "../table-push.ts";

const itemsTable = defineUnmanagedTable({
  tableName: "store_migrate_rls_items",
  columns: [
    {
      name: "id",
      pgType: "uuid",
      notNull: true,
      primaryKey: true,
      defaultSql: "gen_random_uuid()",
    },
    { name: "tenant_id", pgType: "uuid", notNull: true },
    { name: "label", pgType: "text", notNull: true },
  ],
});

const tenants = [testTenantId(411), testTenantId(412), testTenantId(413)];

let testDb: TestDb;

const labelsOf = (): Promise<string[]> =>
  runInSystemRowLevelSecurityScope(async () =>
    (
      await asRawClient(testDb.db).unsafe<{ label: string }>(
        `SELECT label FROM "store_migrate_rls_items" ORDER BY label`,
      )
    ).map((row) => row.label),
  );

beforeAll(async () => {
  testDb = await createTestDb({ applicationRole: true });
  await unsafePushTables(testDb.db, { items: itemsTable });
  await runInSystemRowLevelSecurityScope(async () => {
    for (const tenant of tenants) {
      await asRawClient(testDb.db).unsafe(
        `INSERT INTO "store_migrate_rls_items" (tenant_id, label) VALUES ($1::uuid, 'before')`,
        [tenant],
      );
    }
  });
});

afterAll(async () => {
  await testDb.cleanup();
});

describe("runMigrations over the application role", () => {
  test("an UPDATE without a tenant filter reaches the rows of every tenant", async () => {
    expect(rowLevelSecurityModeOf(testDb.db)).toBe("on");
    const migration: Migration = {
      id: "0001_rewrite_labels",
      checksum: "rls-test-0001",
      statements: [`UPDATE "store_migrate_rls_items" SET label = 'after'`],
    };
    const result = await runMigrations(testDb.db, [migration]);
    expect(result.applied).toEqual(["0001_rewrite_labels"]);
    expect(await labelsOf()).toEqual(["after", "after", "after"]);
  });

  test("the scope ends with the migration: a plain pool statement afterwards sees nothing", async () => {
    const rows = await asRawClient(testDb.db).unsafe(`SELECT 1 FROM "store_migrate_rls_items"`);
    expect(rows).toEqual([]);
  });
});
