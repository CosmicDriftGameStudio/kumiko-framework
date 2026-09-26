import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { TenantDb } from "@cosmicdrift/kumiko-types/tenant-db-types";
import { createBooleanField, createEntity, createTextField } from "../../engine";
import { AccessDeniedError, InternalError } from "../../errors";
import {
  createTestDb,
  type TestDb,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
} from "../../stack";
import type { TableColumns } from "../dialect";
import { buildEntityTable } from "../table-builder";
import {
  assertPersonalDataWrite,
  createTenantDb,
  type PersonalDataGate,
  runInOwnTransaction,
} from "../tenant-db";

const entity = createEntity({
  table: "run_in_own_tx_items",
  fields: {
    name: createTextField({ required: true, personal: false, reason: "test_fixture" }),
    isActive: createBooleanField({ default: true }),
  },
  softDelete: true,
});

const table: TableColumns = buildEntityTable("runInOwnTxItem", entity);

let testDb: TestDb;
const tenant1 = TestUsers.admin; // tenantId: 1
const tenant2 = TestUsers.otherTenant; // tenantId: 2

beforeAll(async () => {
  testDb = await createTestDb();
  await unsafeCreateEntityTable(testDb.db, entity, "runInOwnTxItem");
});

afterAll(async () => {
  await testDb.cleanup();
});

describe("runInOwnTransaction", () => {
  test("the tenant filter holds on the tx-bound db", async () => {
    const tdb1 = createTenantDb(testDb.db, tenant1.tenantId);
    const tdb2 = createTenantDb(testDb.db, tenant2.tenantId);
    const marker = `shared-name-${crypto.randomUUID()}`;
    await tdb2.insertOne(table, { name: marker });

    const rows = await runInOwnTransaction(tdb1, async (txDb) => {
      await txDb.insertOne(table, { name: marker });
      return txDb.selectMany(table, { name: marker });
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!["tenantId"]).toBe(testTenantId(1));
  });

  test("a throw in fn rolls back the tx's own writes", async () => {
    const tdb = createTenantDb(testDb.db, tenant1.tenantId);
    const marker = `rollback-${crypto.randomUUID()}`;

    await expect(
      runInOwnTransaction(tdb, async (txDb) => {
        await txDb.insertOne(table, { name: marker });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const rows = await tdb.selectMany(table, { name: marker });
    expect(rows).toHaveLength(0);
  });

  test("commits the tx's writes on success", async () => {
    const tdb = createTenantDb(testDb.db, tenant1.tenantId);
    const marker = `commit-${crypto.randomUUID()}`;

    await runInOwnTransaction(tdb, async (txDb) => {
      await txDb.insertOne(table, { name: marker });
    });

    const rows = await tdb.selectMany(table, { name: marker });
    expect(rows).toHaveLength(1);
  });

  test("throws InternalError for a TenantDb not built by createTenantDb", async () => {
    const handBuilt = { tenantId: testTenantId(1), mode: "tenant" } as unknown as TenantDb;

    await expect(runInOwnTransaction(handBuilt, async () => undefined)).rejects.toThrow(
      InternalError,
    );
  });

  test("throws InternalError for a throwing guard Proxy, without the proxy's get trap firing", async () => {
    let getTrapFired = false;
    const guardProxy = new Proxy(
      {},
      {
        get() {
          getTrapFired = true;
          throw new Error("systemScope guard: property access denied");
        },
      },
    ) as unknown as TenantDb;

    await expect(runInOwnTransaction(guardProxy, async () => undefined)).rejects.toThrow(
      InternalError,
    );
    expect(getTrapFired).toBe(false);
  });

  test("throws InternalError for a memberReadOnly TenantDb", async () => {
    const tdb = createTenantDb(
      testDb.db,
      tenant1.tenantId,
      "tenant",
      undefined,
      undefined,
      undefined,
      { memberReadOnly: true },
    );

    await expect(runInOwnTransaction(tdb, async () => undefined)).rejects.toThrow(InternalError);
  });

  test("throws InternalError when the runner has no begin() (already inside a transaction)", async () => {
    const tdb = createTenantDb(testDb.db, tenant1.tenantId);

    await expect(
      runInOwnTransaction(tdb, async (txDb) => runInOwnTransaction(txDb, async () => undefined)),
    ).rejects.toThrow(InternalError);
  });

  test("a runner-bound personalDataGate (not declared on this TenantDb) still applies on the tx-bound db", async () => {
    const denyEmail: PersonalDataGate = (_tableName, keys) => {
      if (keys.includes("email")) {
        throw new AccessDeniedError({ message: "personal data blocked" });
      }
    };
    const tdb = createTenantDb(
      testDb.db,
      tenant1.tenantId,
      "tenant",
      undefined,
      undefined,
      undefined,
      { personalDataGate: denyEmail, unsafeRaw: { reason: "test: derive runner-bound gate" } },
    );
    // Mirrors createTenantDb(ctx.db.unsafeRaw(reason), ...): the gate now lives on the
    // runner, not in this new TenantDb's own (unset) grants.
    const gatedRunner = tdb.unsafeRaw("test: derive runner-bound gate");
    const runnerBoundTdb = createTenantDb(gatedRunner, tenant1.tenantId);

    expect(() =>
      assertPersonalDataWrite(runnerBoundTdb, "run_in_own_tx_items", ["email"], entity),
    ).toThrow(AccessDeniedError);

    await runInOwnTransaction(runnerBoundTdb, async (txDb) => {
      expect(() => assertPersonalDataWrite(txDb, "run_in_own_tx_items", ["email"], entity)).toThrow(
        AccessDeniedError,
      );
    });
  });
});
