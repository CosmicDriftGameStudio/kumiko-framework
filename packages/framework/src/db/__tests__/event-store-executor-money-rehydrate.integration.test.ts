// fw#1855 — money columns in list()/detail() surfaced the raw minor-units
// integer instead of { amount, currency }: rehydrateCompoundTypes ran BEFORE
// coerceRow on raw-SQL rows, so rehydrateMoney looked up the still-snake_case
// key and silently no-op'd. money.test.ts/compound-types.test.ts only feed
// rehydrateMoney pre-camelCased rows directly — neither covers the real
// list()/detail() path through raw SQL, which is why this went unnoticed.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { type BunTestDb, createTestDb } from "../../bun-db/__tests__/bun-test-db";
import { asRawClient } from "../../db/query";
import { createEntity, createMoneyField, createTextField, from } from "../../engine";
import { createEventsTable } from "../../event-store";
import { TestUsers, unsafeCreateEntityTable } from "../../stack";
import { createTestEnvelopeCipher } from "../../testing";
import { ensureTemporalPolyfill } from "../../time/polyfill";
import {
  configureEntityFieldEncryption,
  resetEntityFieldEncryptionCacheForTests,
} from "../entity-field-encryption";
import { createEventStoreExecutor } from "../event-store-executor";
import { buildEntityTable } from "../table-builder";
import { createTenantDb, type TenantDb } from "../tenant-db";

const TEST_KEY = Buffer.from("a]bJm#kP9xQ2@wN!vL$hR5yT8eU0iO3f").toString("base64");
const cipher = createTestEnvelopeCipher(TEST_KEY);

// Multi-word field name on purpose: "price" maps to column "price" (snake ==
// camel), which would pass even with the key-mismatch bug still present.
// "grossTotal" maps to "gross_total" / "gross_total_currency" and exposes it.
// billingIban ("billing_iban") is multi-word + encrypted: true for the same
// reason, targeting the encrypted-field variant of the bug on detail()'s
// ownership.kind==="sql" branch (decryptForRead used to run against a still
// snake_case row and silently skip the field, leaking ciphertext).
const entity = createEntity({
  table: "read_money_orders",
  fields: {
    ownerId: createTextField({ required: true }),
    grossTotal: createMoneyField(),
    billingIban: createTextField({ required: true, encrypted: true }),
  },
  // A non-"all" read rule forces buildOwnershipClause into the
  // ownership.kind==="sql" raw-SQL branch that list()/detail() read through.
  // The "pass" branch (db.fetchOne → selectMany → coerceRows) is already
  // camelCase and would pass this test even with the bug present.
  access: { read: { Admin: from("user:id", "ownerId") } },
});
const table = buildEntityTable("moneyOrder", entity);

let testDb: BunTestDb;
let tdb: TenantDb;
const admin = TestUsers.admin;

beforeAll(async () => {
  await ensureTemporalPolyfill();
  testDb = await createTestDb();
  await unsafeCreateEntityTable(testDb.db, entity, "moneyOrder");
  await createEventsTable(testDb.db);
  tdb = createTenantDb(testDb.db, admin.tenantId);
  configureEntityFieldEncryption(cipher);
});

afterAll(async () => {
  resetEntityFieldEncryptionCacheForTests();
  await testDb.cleanup();
});

beforeEach(async () => {
  await asRawClient(testDb.db).unsafe(
    `TRUNCATE kumiko_events, read_money_orders RESTART IDENTITY CASCADE`,
  );
});

describe("event-store-executor — money column rehydration through raw SQL (fw#1855)", () => {
  const exec = createEventStoreExecutor(table, entity, { entityName: "moneyOrder" });

  test("list(): money column arrives as { amount, currency }, not the raw minor-units integer", async () => {
    const created = await exec.create(
      {
        ownerId: admin.id,
        grossTotal: { amount: 136.85, currency: "EUR" },
        billingIban: "DE1234567890",
      },
      admin,
      tdb,
    );
    expect(created.isSuccess).toBe(true);

    const res = await exec.list({ limit: 50 }, admin, tdb);
    expect(res.rows).toHaveLength(1);
    const row = res.rows[0] as Record<string, unknown>;
    expect(row["grossTotal"]).toEqual({ amount: 136.85, currency: "EUR", amountMinor: 13685 });
    expect("grossTotalCurrency" in row).toBe(false);
  });

  test('detail() via ownership.kind==="sql": money column arrives as { amount, currency }', async () => {
    const created = await exec.create(
      {
        ownerId: admin.id,
        grossTotal: { amount: 42.5, currency: "USD" },
        billingIban: "DE9876543210",
      },
      admin,
      tdb,
    );
    expect(created.isSuccess).toBe(true);
    if (!created.isSuccess) return;

    const row = (await exec.detail({ id: created.data.id }, admin, tdb)) as Record<
      string,
      unknown
    > | null;
    expect(row).not.toBeNull();
    if (!row) return;
    expect(row["grossTotal"]).toEqual({ amount: 42.5, currency: "USD", amountMinor: 4250 });
    expect("grossTotalCurrency" in row).toBe(false);
  });

  test('detail() via ownership.kind==="sql": encrypted field decrypts to plaintext, not ciphertext', async () => {
    const plainIban = "DE44500105175407324931";
    const created = await exec.create(
      {
        ownerId: admin.id,
        grossTotal: { amount: 10, currency: "EUR" },
        billingIban: plainIban,
      },
      admin,
      tdb,
    );
    expect(created.isSuccess).toBe(true);
    if (!created.isSuccess) return;

    const row = (await exec.detail({ id: created.data.id }, admin, tdb)) as Record<
      string,
      unknown
    > | null;
    expect(row).not.toBeNull();
    if (!row) return;
    expect(row["billingIban"]).toBe(plainIban);
  });
});
