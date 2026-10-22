import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { testTenantId } from "../../seeding/seed-users.ts";
import { defineUnmanagedTable } from "../entity-table-meta.ts";
import { markExecutorManagedTable } from "../executor-managed-tables.ts";
import { createTenantDb } from "../tenant-db.ts";

const columns = [
  { name: "id", pgType: "uuid", notNull: true, primaryKey: true, defaultSql: "gen_random_uuid()" },
  { name: "tenant_id", pgType: "uuid", notNull: true },
  { name: "code", pgType: "text", notNull: true },
  { name: "token", pgType: "text", notNull: true },
  { name: "label", pgType: "text", notNull: true },
] as const;

const slotsTable = defineUnmanagedTable({
  tableName: "store_upsert_slots_it",
  columns,
  indexes: [
    { name: "store_upsert_slots_it_tenant_code", columns: ["tenant_id", "code"], unique: true },
    { name: "store_upsert_slots_it_token", columns: ["token"], unique: true },
  ],
});

const managedTable = defineUnmanagedTable({
  tableName: "store_upsert_managed_it",
  columns,
  indexes: [{ name: "store_upsert_managed_it_tc", columns: ["tenant_id", "code"], unique: true }],
});
markExecutorManagedTable(managedTable);

const tenantA = testTenantId(91);
const tenantB = testTenantId(92);
const byCode = { conflictTarget: ["tenantId", "code"] } as const;

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [] });
  await unsafePushTables(stack.db, { slots: slotsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("TenantDb.upsert", () => {
  test("a conflict on the own tenant updates the row, B gets its own row", async () => {
    const dbA = createTenantDb({ db: stack.db, tenantId: tenantA });
    const dbB = createTenantDb({ db: stack.db, tenantId: tenantB });

    await dbA.upsert(slotsTable, { code: "c1", token: "tok-1", label: "first" }, byCode);
    const second = await dbA.upsert(
      slotsTable,
      { code: "c1", token: "tok-1", label: "second" },
      byCode,
    );
    expect(second).toMatchObject({ code: "c1", label: "second" });
    expect(await dbA.selectMany(slotsTable, { code: "c1" })).toHaveLength(1);

    await dbB.upsert(slotsTable, { code: "c1", token: "tok-b", label: "b-row" }, byCode);
    expect(await dbA.selectMany(slotsTable, { code: "c1" })).toMatchObject([
      { label: "second", token: "tok-1" },
    ]);
    expect(await dbB.selectMany(slotsTable, { code: "c1" })).toMatchObject([
      { label: "b-row", token: "tok-b" },
    ]);
  });

  test("another tenant's unique token violates the constraint and leaves the row alone", async () => {
    const dbA = createTenantDb({ db: stack.db, tenantId: tenantA });
    const dbB = createTenantDb({ db: stack.db, tenantId: tenantB });
    await dbA.upsert(slotsTable, { code: "tok-owner", token: "tok-shared", label: "a" }, byCode);

    await expect(
      dbB.upsert(slotsTable, { code: "other", token: "tok-shared", label: "hijack" }, byCode),
    ).rejects.toThrow();
    expect(await dbA.selectMany(slotsTable, { token: "tok-shared" })).toMatchObject([
      { label: "a" },
    ]);
  });

  test("rejects a conflictTarget without tenantId and one matching no unique index", async () => {
    const dbA = createTenantDb({ db: stack.db, tenantId: tenantA });
    const values = { code: "x", token: "tok-x", label: "x" };
    await expect(dbA.upsert(slotsTable, values, { conflictTarget: ["token"] })).rejects.toThrow(
      /must include "tenantId"/,
    );
    await expect(
      dbA.upsert(slotsTable, values, { conflictTarget: ["tenantId", "label"] }),
    ).rejects.toThrow(/matches no declared unique index/);
  });

  test("rejects an update that sets tenantId", async () => {
    const dbA = createTenantDb({ db: stack.db, tenantId: tenantA });
    await expect(
      dbA.upsert(
        slotsTable,
        { code: "c1", token: "tok-1", label: "x" },
        { ...byCode, update: { tenantId: tenantB } },
      ),
    ).rejects.toThrow(/must not set "tenantId"/);
  });

  test("the default update keeps the primary key of the existing row", async () => {
    const dbA = createTenantDb({ db: stack.db, tenantId: tenantA });
    const first = await dbA.upsert<{ id: string }>(
      slotsTable,
      { code: "pk", token: "tok-pk", label: "one" },
      byCode,
    );
    const second = await dbA.upsert<{ id: string; label: string }>(
      slotsTable,
      { id: crypto.randomUUID(), code: "pk", token: "tok-pk", label: "two" },
      byCode,
    );
    expect(second?.id).toBe(first?.id);
    expect(second?.label).toBe("two");
  });

  test("an explicit update only sets the listed columns", async () => {
    const dbA = createTenantDb({ db: stack.db, tenantId: tenantA });
    await dbA.upsert(slotsTable, { code: "ex", token: "tok-ex", label: "keep" }, byCode);
    const row = await dbA.upsert(
      slotsTable,
      { code: "ex", token: "tok-ex", label: "ignored" },
      { ...byCode, update: { label: "set" } },
    );
    expect(row).toMatchObject({ label: "set", token: "tok-ex" });
  });

  test("event-fed tables and write-denied handles are rejected", async () => {
    const dbA = createTenantDb({ db: stack.db, tenantId: tenantA });
    await expect(
      dbA.upsert(managedTable, { code: "m", token: "t", label: "l" }, byCode),
    ).rejects.toThrow(/fed by events/);

    const denied = createTenantDb({
      db: stack.db,
      tenantId: tenantA,
      grants: { writesDeniedReason: "without an open transaction" },
    });
    await expect(
      denied.upsert(slotsTable, { code: "d", token: "tok-d", label: "l" }, byCode),
    ).rejects.toThrow(/ctx\.db\.upsert: writes are not available/);
  });
});
