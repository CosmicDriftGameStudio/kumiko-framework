import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { testTenantId } from "../../seeding/seed-users.ts";
import { defineUnmanagedTable } from "../entity-table-meta.ts";
import { markExecutorManagedTable } from "../executor-managed-tables.ts";
import { constraintOf, isUniqueViolation } from "../pg-error.ts";
import { createTenantDb } from "../tenant-db.ts";

const columns = [
  { name: "id", pgType: "uuid", notNull: true, primaryKey: true, defaultSql: "gen_random_uuid()" },
  { name: "tenant_id", pgType: "uuid", notNull: true },
  { name: "code", pgType: "text", notNull: true },
  { name: "token", pgType: "text", notNull: true },
  { name: "label", pgType: "text", notNull: true },
  { name: "hits", pgType: "integer", notNull: true, defaultSql: "0" },
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

    const failure = await dbB
      .upsert(slotsTable, { code: "other", token: "tok-shared", label: "hijack" }, byCode)
      .then(
        () => undefined,
        (err: unknown) => err,
      );
    expect(isUniqueViolation(failure)).toBe(true);
    expect(constraintOf(failure)).toBe("store_upsert_slots_it_token");
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

describe("TenantDb.upsert increment", () => {
  test("starts at the delta on insert and adds it on conflict", async () => {
    const dbA = createTenantDb({ db: stack.db, tenantId: tenantA });
    const row = { code: "inc1", token: "tok-inc1", label: "x" };

    const first = await dbA.upsert(slotsTable, row, { ...byCode, increment: { hits: 1 } });
    const second = await dbA.upsert(slotsTable, row, { ...byCode, increment: { hits: 1 } });

    expect(first).toMatchObject({ hits: 1 });
    expect(second).toMatchObject({ hits: 2 });
  });

  test("parallel increments on one key add up exactly", async () => {
    const dbA = createTenantDb({ db: stack.db, tenantId: tenantA });

    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        dbA.upsert(
          slotsTable,
          { code: "par", token: "tok-par-" + i, label: "x" },
          { ...byCode, update: { label: "par" }, increment: { hits: 1 } },
        ),
      ),
    );

    expect(await dbA.fetchOne(slotsTable, { code: "par" })).toMatchObject({ hits: 20 });
  });

  test("another tenant's increment on the same code leaves A's counter alone", async () => {
    const dbA = createTenantDb({ db: stack.db, tenantId: tenantA });
    const dbB = createTenantDb({ db: stack.db, tenantId: tenantB });
    const rowA = { code: "own", token: "tok-own-a", label: "a" };
    await dbA.upsert(slotsTable, rowA, { ...byCode, increment: { hits: 1 } });
    await dbA.upsert(slotsTable, rowA, { ...byCode, increment: { hits: 1 } });

    await dbB.upsert(
      slotsTable,
      { code: "own", token: "tok-own-b", label: "b" },
      { ...byCode, increment: { hits: 1 } },
    );

    expect(await dbA.fetchOne(slotsTable, { code: "own" })).toMatchObject({ hits: 2 });
    expect(await dbB.fetchOne(slotsTable, { code: "own" })).toMatchObject({ hits: 1 });
  });

  test("rejects increments that cannot be applied atomically", async () => {
    const dbA = createTenantDb({ db: stack.db, tenantId: tenantA });
    const row = { code: "bad", token: "tok-bad", label: "x" };

    await expect(
      dbA.upsert(slotsTable, row, {
        ...byCode,
        update: { hits: 5 },
        increment: { hits: 1 },
      }),
    ).rejects.toThrow(/both in update and increment/);
    await expect(
      dbA.upsert(slotsTable, row, { ...byCode, increment: { code: 1 } }),
    ).rejects.toThrow(/key column/);
    await expect(
      dbA.upsert(slotsTable, row, { ...byCode, increment: { label: 1 } }),
    ).rejects.toThrow(/numeric column/);
    await expect(
      dbA.upsert(slotsTable, row, { ...byCode, increment: { hits: Number.POSITIVE_INFINITY } }),
    ).rejects.toThrow(/finite number/);
    await expect(
      dbA.upsert(slotsTable, row, { ...byCode, increment: { hits: 1.5 } }),
    ).rejects.toThrow(/integer for integer columns/);
  });
});
