import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestDb, type TestDb } from "@cosmicdrift/kumiko-testing/stack";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { TestUsers } from "../../seeding/seed-users.ts";
import { asRawClient, transaction } from "../query.ts";
import { createTenantDb } from "../tenant-db.ts";

const NAMESPACE = 0x74657374;
const KEY = "shared-key";
const tenantA = TestUsers.admin.tenantId;
const tenantB = TestUsers.otherTenant.tenantId;

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
});

afterAll(async () => {
  await testDb.cleanup();
});

// Probes from a second connection whether the (tenant, key) lock is currently held.
async function isHeldByAnotherTransaction(tenantId: string): Promise<boolean> {
  return transaction(testDb.db, async (probe) => {
    const rows = await asRawClient(probe).unsafe(
      `SELECT pg_try_advisory_xact_lock($1, hashtext($2)) AS acquired`,
      [NAMESPACE, `${tenantId}:${KEY}`],
    );
    return propertyOf(rows[0], "acquired") === false;
  });
}

describe("TenantDb.advisoryXactLock", () => {
  test("holds the lock for the same tenant until commit, without blocking another tenant", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let signalAcquired: () => void = () => {};
    const acquired = new Promise<void>((resolve) => {
      signalAcquired = resolve;
    });

    const holder = transaction(testDb.db, async (tx) => {
      await createTenantDb({ db: tx, tenantId: tenantA }).advisoryXactLock(NAMESPACE, KEY);
      signalAcquired();
      await gate;
    });

    await acquired;
    expect(await isHeldByAnotherTransaction(tenantA)).toBe(true);
    expect(await isHeldByAnotherTransaction(tenantB)).toBe(false);

    // Tenant B takes the same key while A still holds it: resolves instead of queueing.
    await transaction(testDb.db, (tx) =>
      createTenantDb({ db: tx, tenantId: tenantB }).advisoryXactLock(NAMESPACE, KEY),
    );

    release();
    await holder;
    expect(await isHeldByAnotherTransaction(tenantA)).toBe(false);
  });

  test("a second transaction of the same tenant waits until the first commits", async () => {
    const order: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let signalAcquired: () => void = () => {};
    const firstAcquired = new Promise<void>((resolve) => {
      signalAcquired = resolve;
    });

    const first = transaction(testDb.db, async (tx) => {
      await createTenantDb({ db: tx, tenantId: tenantA }).advisoryXactLock(NAMESPACE, KEY);
      order.push("first-acquired");
      signalAcquired();
      await gate;
      order.push("first-commit");
    });
    await firstAcquired;

    const second = transaction(testDb.db, async (tx) => {
      await createTenantDb({ db: tx, tenantId: tenantA }).advisoryXactLock(NAMESPACE, KEY);
      order.push("second-acquired");
    });

    // The second transaction is observably queued behind the lock before the first is released.
    await waitForAdvisoryWaiter();
    expect(order).toEqual(["first-acquired"]);

    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-acquired", "first-commit", "second-acquired"]);
  });
});

async function waitForAdvisoryWaiter(): Promise<void> {
  for (;;) {
    const rows = await asRawClient(testDb.db).unsafe(
      `SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`,
      [],
    );
    if (rows.length > 0) return;
  }
}
