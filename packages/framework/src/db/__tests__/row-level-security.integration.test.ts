// Row level security DDL against real Postgres; enforcement is probed through rls-probe.ts.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestDb, type TestDb } from "@cosmicdrift/kumiko-testing/stack";
import { SYSTEM_TENANT_ID } from "../../engine/types/index.ts";
import { testTenantId } from "../../seeding/seed-users.ts";
import { defineUnmanagedTable, type EntityTableMeta } from "../entity-table-meta.ts";
import { readRowLevelSecurityState } from "../queries/rls-catalog.ts";
import { asRawClient } from "../query.ts";
import { SYSTEM_SCOPE } from "../render-rls-ddl.ts";
import { unsafePushTables } from "../table-push.ts";
import {
  asProbe,
  createProbeRole,
  grantProbeDml,
  INSUFFICIENT_PRIVILEGE,
  pgCodeOf,
  visibleTenants,
} from "./rls-probe.ts";

function tenantTable(tableName: string, tenantType: "uuid" | "text"): EntityTableMeta {
  return defineUnmanagedTable({
    tableName,
    columns: [
      {
        name: "id",
        pgType: "uuid",
        notNull: true,
        primaryKey: true,
        defaultSql: "gen_random_uuid()",
      },
      { name: "tenant_id", pgType: tenantType, notNull: true },
      { name: "label", pgType: "text", notNull: false },
    ],
  });
}

const itemsTable = tenantTable("store_rls_items", "uuid");
const textItemsTable = tenantTable("store_rls_text_items", "text");
const plainTable = defineUnmanagedTable({
  tableName: "store_rls_plain",
  tenancy: "global",
  columns: [
    {
      name: "id",
      pgType: "uuid",
      notNull: true,
      primaryKey: true,
      defaultSql: "gen_random_uuid()",
    },
  ],
});
const offTable = tenantTable("store_rls_off", "uuid");
const lateTable = tenantTable("store_rls_late", "uuid");
const racedTable = tenantTable("store_rls_raced", "uuid");

const tenantA = testTenantId(201);
const tenantB = testTenantId(202);
const textTenantA = "text-tenant-a";
const textTenantB = "text-tenant-b";

let testDb: TestDb;

async function stateOf(tableName: string) {
  return readRowLevelSecurityState(testDb.db, "public", tableName);
}

beforeAll(async () => {
  testDb = await createTestDb();
  await unsafePushTables(
    testDb.db,
    { items: itemsTable, textItems: textItemsTable, plain: plainTable },
    undefined,
    { rowLevelSecurity: "on" },
  );
  await unsafePushTables(testDb.db, { off: offTable });

  const raw = asRawClient(testDb.db);
  await createProbeRole(testDb.db);
  await grantProbeDml(testDb.db, ["store_rls_items", "store_rls_text_items"]);
  for (const tenant of [tenantA, tenantB, SYSTEM_TENANT_ID]) {
    await raw.unsafe(`INSERT INTO "store_rls_items" (tenant_id, label) VALUES ($1::uuid, $2)`, [
      tenant,
      `seed-${tenant}`,
    ]);
  }
  for (const tenant of [textTenantA, textTenantB, SYSTEM_TENANT_ID]) {
    await raw.unsafe(`INSERT INTO "store_rls_text_items" (tenant_id, label) VALUES ($1, $2)`, [
      tenant,
      `seed-${tenant}`,
    ]);
  }
});

afterAll(async () => {
  await testDb.cleanup();
});

describe("unsafePushTables with rowLevelSecurity", () => {
  test("on enables and forces RLS with exactly the two kumiko policies", async () => {
    const state = await stateOf("store_rls_items");
    expect(state?.enabled).toBe(true);
    expect(state?.forced).toBe(true);
    expect(state?.policies.map((p) => p.name)).toEqual([
      "kumiko_system_tenant_read",
      "kumiko_tenant_isolation",
    ]);
  });

  test("a second push is idempotent", async () => {
    const before = await stateOf("store_rls_items");
    await unsafePushTables(testDb.db, { items: itemsTable }, undefined, { rowLevelSecurity: "on" });
    expect(await stateOf("store_rls_items")).toEqual(before);
  });

  test("the prev branch applies RLS as well", async () => {
    await unsafePushTables(testDb.db, { late: lateTable });
    expect((await stateOf("store_rls_late"))?.enabled).toBe(false);
    await unsafePushTables(
      testDb.db,
      { late: lateTable },
      { late: lateTable },
      {
        rowLevelSecurity: "on",
      },
    );
    const state = await stateOf("store_rls_late");
    expect(state).toMatchObject({ enabled: true, forced: true });
    expect(state?.policies).toHaveLength(2);
  });

  test("two parallel pushes both succeed", async () => {
    await unsafePushTables(testDb.db, { raced: racedTable });
    await Promise.all([
      unsafePushTables(testDb.db, { raced: racedTable }, undefined, { rowLevelSecurity: "on" }),
      unsafePushTables(testDb.db, { raced: racedTable }, undefined, { rowLevelSecurity: "on" }),
    ]);
    const state = await stateOf("store_rls_raced");
    expect(state).toMatchObject({ enabled: true, forced: true });
    expect(state?.policies).toHaveLength(2);
  });

  test("a table without tenant_id gets no policy and no flags", async () => {
    expect(await stateOf("store_rls_plain")).toEqual({
      enabled: false,
      forced: false,
      policies: [],
    });
  });

  test("off leaves the table untouched", async () => {
    expect(await stateOf("store_rls_off")).toEqual({ enabled: false, forced: false, policies: [] });
  });

  test("a text tenant_id table gets the policies", async () => {
    const state = await stateOf("store_rls_text_items");
    expect(state).toMatchObject({ enabled: true, forced: true });
    expect(state?.policies).toHaveLength(2);
  });
});

const INSERT_ITEM = `INSERT INTO "store_rls_items" (tenant_id, label) VALUES ($1::uuid, 'probe')`;

describe("enforcement of the generated policies", () => {
  test("without any session setting no row is visible", async () => {
    expect(await asProbe(testDb.db, {}, (raw) => visibleTenants(raw, "store_rls_items"))).toEqual(
      [],
    );
  });

  test("an empty tenant setting sees nothing and does not raise", async () => {
    expect(
      await asProbe(testDb.db, { tenantId: "" }, (raw) => visibleTenants(raw, "store_rls_items")),
    ).toEqual([]);
  });

  test("a tenant sees its own rows and SYSTEM rows, never another tenant's", async () => {
    const visible = await asProbe(testDb.db, { tenantId: tenantA }, (raw) =>
      visibleTenants(raw, "store_rls_items"),
    );
    expect(visible.sort()).toEqual([tenantA, SYSTEM_TENANT_ID].sort());
  });

  test("inserting for another tenant or for SYSTEM is rejected", async () => {
    const codes = await asProbe(testDb.db, { tenantId: tenantA }, async (raw) => [
      await pgCodeOf(raw.unsafe(INSERT_ITEM, [tenantB])),
    ]);
    expect(codes).toEqual([INSUFFICIENT_PRIVILEGE]);
    const systemCode = await asProbe(testDb.db, { tenantId: tenantA }, (raw) =>
      pgCodeOf(raw.unsafe(INSERT_ITEM, [SYSTEM_TENANT_ID])),
    );
    expect(systemCode).toBe(INSUFFICIENT_PRIVILEGE);
  });

  test("inserting for the own tenant works", async () => {
    const code = await asProbe(testDb.db, { tenantId: tenantA }, (raw) =>
      pgCodeOf(raw.unsafe(INSERT_ITEM, [tenantA])),
    );
    expect(code).toBeUndefined();
  });

  test("UPDATE and DELETE of a SYSTEM row affect no row", async () => {
    const affected = await asProbe(testDb.db, { tenantId: tenantA }, async (raw) => {
      const updated = await raw.unsafe(
        `UPDATE "store_rls_items" SET label = 'changed' WHERE tenant_id = $1::uuid RETURNING id`,
        [SYSTEM_TENANT_ID],
      );
      const deleted = await raw.unsafe(
        `DELETE FROM "store_rls_items" WHERE tenant_id = $1::uuid RETURNING id`,
        [SYSTEM_TENANT_ID],
      );
      return { updated: updated.length, deleted: deleted.length };
    });
    expect(affected).toEqual({ updated: 0, deleted: 0 });
  });

  test("moving an own row to another tenant is rejected", async () => {
    const code = await asProbe(testDb.db, { tenantId: tenantA }, (raw) =>
      pgCodeOf(
        raw.unsafe(`UPDATE "store_rls_items" SET tenant_id = $1::uuid WHERE tenant_id = $2::uuid`, [
          tenantB,
          tenantA,
        ]),
      ),
    );
    expect(code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  test("system scope sees every row and may write for any tenant", async () => {
    const outcome = await asProbe(testDb.db, { scope: SYSTEM_SCOPE }, async (raw) => ({
      visible: await visibleTenants(raw, "store_rls_items"),
      insertCode: await pgCodeOf(raw.unsafe(INSERT_ITEM, [tenantB])),
    }));
    expect(outcome.visible).toEqual([tenantA, tenantB, SYSTEM_TENANT_ID].sort());
    expect(outcome.insertCode).toBeUndefined();
  });

  test("a text tenant_id table isolates the same way", async () => {
    const outcome = await asProbe(testDb.db, { tenantId: textTenantA }, async (raw) => ({
      visible: await visibleTenants(raw, "store_rls_text_items"),
      foreignInsert: await pgCodeOf(
        raw.unsafe(`INSERT INTO "store_rls_text_items" (tenant_id) VALUES ($1)`, [textTenantB]),
      ),
    }));
    expect(outcome.visible).toEqual([SYSTEM_TENANT_ID, textTenantA].sort());
    expect(outcome.foreignInsert).toBe(INSUFFICIENT_PRIVILEGE);
  });
});
