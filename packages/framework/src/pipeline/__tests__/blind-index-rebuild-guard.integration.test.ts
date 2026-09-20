// projection-rebuild aborts instead of silently NULLing an already-populated
// blind-index column when this process has no blind-index key configured
// (fw#3091) — see assertNoBlindIndexLoss in db/queries/shadow-swap.ts.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { resetBlindIndexKeyForTests } from "@cosmicdrift/kumiko-framework/testing";
import { computeBlindIndex, configureBlindIndexKey, decodeBlindIndexKey } from "../../crypto";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { asRawClient } from "../../db/query";
import { buildEntityTable } from "../../db/table-builder";
import { createTenantDb, type TenantDb } from "../../db/tenant-db";
import { createEntity, createRegistry, createTextField, defineFeature } from "../../engine";
import { createProjectionStateTable, rebuildProjection } from "../../pipeline";
import { createTestDb, type TestDb, TestUsers, unsafeCreateEntityTable } from "../../stack";

const TEST_KEY_B64 = Buffer.alloc(32, 9).toString("base64");
const TEST_KEY = decodeBlindIndexKey(TEST_KEY_B64);

const personEntity = createEntity({
  table: "read_bidx_guard_persons",
  fields: {
    email: createTextField({ required: true, personal: "self", find: "exact" }),
  },
});
const personFeature = defineFeature("bidxguardtest", (r) => {
  r.entity("person", personEntity);
});
const personTable = buildEntityTable("person", personEntity);
const implicitName = "bidxguardtest:projection:person-entity";

const admin = TestUsers.admin;
let testDb: TestDb;
let tdb: TenantDb;
const registry = createRegistry([personFeature]);
const crud = createEventStoreExecutor(personTable, personEntity, { entityName: "person" });

beforeAll(async () => {
  testDb = await createTestDb();
  await unsafeCreateEntityTable(testDb.db, personEntity, "person");
  await createProjectionStateTable(testDb.db);
  tdb = createTenantDb(testDb.db, admin.tenantId);
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await asRawClient(testDb.db).unsafe(
    `TRUNCATE kumiko_events, read_bidx_guard_persons, kumiko_projections RESTART IDENTITY CASCADE`,
  );
  configureBlindIndexKey(TEST_KEY_B64);
});

afterEach(() => {
  resetBlindIndexKeyForTests();
});

async function rawRow(id: string): Promise<Record<string, unknown>> {
  const rows = await asRawClient(testDb.db).unsafe<Record<string, unknown>>(
    `SELECT * FROM read_bidx_guard_persons WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new Error(`no row for ${id}`);
  return row;
}

describe("projection-rebuild — blind-index loss guard (fw#3091)", () => {
  test("populated bidx column + no key in this process → rebuild throws, live table untouched", async () => {
    const created = await crud.create({ email: "marc@example.com" }, admin, tdb);
    if (!created.isSuccess) throw new Error("create failed");
    const before = await rawRow(String(created.data.id));
    expect(before["email_bidx"]).toBe(computeBlindIndex(TEST_KEY, "marc@example.com"));

    resetBlindIndexKeyForTests();
    await expect(rebuildProjection(implicitName, { db: testDb.db, registry })).rejects.toThrow(
      /KUMIKO_BLIND_INDEX_KEY/,
    );

    const after = await rawRow(String(created.data.id));
    expect(after).toEqual(before);
  });

  test("populated bidx column + key configured → rebuild succeeds, bidx recomputed", async () => {
    const created = await crud.create({ email: "marc@example.com" }, admin, tdb);
    if (!created.isSuccess) throw new Error("create failed");

    await rebuildProjection(implicitName, { db: testDb.db, registry });

    const after = await rawRow(String(created.data.id));
    expect(after["email_bidx"]).toBe(computeBlindIndex(TEST_KEY, "marc@example.com"));
  });
});
