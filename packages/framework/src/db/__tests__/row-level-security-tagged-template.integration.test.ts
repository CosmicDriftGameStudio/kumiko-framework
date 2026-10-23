// Tagged-template statements and index DDL on an enforced application-role pool.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestDb, type TestDb } from "@cosmicdrift/kumiko-testing/stack";
import { createEventsTable } from "../../event-store/index.ts";
import { testTenantId } from "../../seeding/seed-users.ts";
import { defineUnmanagedTable } from "../entity-table-meta.ts";
import {
  ensureIdempotencyKeyIndex,
  ensureMembershipPayloadTenantIndex,
} from "../queries/event-store.ts";
import { asRawClient } from "../query.ts";
import {
  runInRowLevelSecurityScope,
  runInSystemRowLevelSecurityScope,
  tenantRowLevelSecurityScope,
} from "../row-level-security-scope.ts";
import { unsafePushTables } from "../table-push.ts";

const itemsTable = defineUnmanagedTable({
  tableName: "store_rls_tagged_items",
  columns: [
    {
      name: "id",
      pgType: "uuid",
      notNull: true,
      primaryKey: true,
      defaultSql: "gen_random_uuid()",
    },
    { name: "tenant_id", pgType: "uuid", notNull: true },
    { name: "label", pgType: "text", notNull: false },
  ],
});

const tenantA = testTenantId(321);
const tenantB = testTenantId(322);

type TaggedSql = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<{ label: string }[]>;

function isTaggedSql(value: unknown): value is TaggedSql {
  return typeof value === "function";
}

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb({ applicationRole: true });
  await unsafePushTables(testDb.db, { items: itemsTable });
  await runInSystemRowLevelSecurityScope("test seeds rows for several tenants", async () => {
    for (const tenant of [tenantA, tenantB]) {
      await asRawClient(testDb.db).unsafe(
        `INSERT INTO "store_rls_tagged_items" (tenant_id, label) VALUES ($1::uuid, $2)`,
        [tenant, `seed-${tenant}`],
      );
    }
  });
});

afterAll(async () => {
  await testDb.cleanup();
});

describe("tagged template on an enforced transaction handle", () => {
  test("every statement runs under the scope active when it is issued, also after a scope change", async () => {
    const seen = await testDb.db.begin(async (tx: unknown) => {
      if (!isTaggedSql(tx)) throw new Error("expected a callable transaction handle");
      const labelsUnder = (tenant: typeof tenantA) =>
        runInRowLevelSecurityScope(tenantRowLevelSecurityScope(tenant), async () =>
          (await tx`SELECT label FROM "store_rls_tagged_items"`).map((row) => row.label),
        );
      const first = await labelsUnder(tenantA);
      const second = await labelsUnder(tenantB);
      const third = await labelsUnder(tenantA);
      return { first, second, third };
    });
    expect(seen).toEqual({
      first: [`seed-${tenantA}`],
      second: [`seed-${tenantB}`],
      third: [`seed-${tenantA}`],
    });
  });

  test("on the pool a tagged template under a scope sees that tenant only", async () => {
    const pool = testDb.db;
    if (!isTaggedSql(pool)) throw new Error("expected a callable pool");
    const rows = await runInRowLevelSecurityScope(
      tenantRowLevelSecurityScope(tenantB),
      () => pool`SELECT label FROM "store_rls_tagged_items"`,
    );
    expect(rows.map((row) => row.label)).toEqual([`seed-${tenantB}`]);
  });
});

describe("index DDL inside an ambient scope", () => {
  test("ensureIdempotencyKeyIndex and ensureMembershipPayloadTenantIndex do not run in a transaction", async () => {
    await createEventsTable(testDb.db);
    await expect(
      runInSystemRowLevelSecurityScope("test ensures cross-tenant indexes", async () => {
        await ensureIdempotencyKeyIndex(testDb.db);
        await ensureMembershipPayloadTenantIndex(testDb.db);
      }),
    ).resolves.toBeUndefined();
  });
});
