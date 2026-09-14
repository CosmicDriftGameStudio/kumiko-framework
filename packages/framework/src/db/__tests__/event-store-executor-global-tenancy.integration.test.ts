// fw#2858 — a `tenancy: "global"` entity's aggregate is tenant-agnostic: create/update
// must reject an explicit foreign (non-SYSTEM) payload.tenantId before it ever reaches
// the projection insert/update. Modelled on event-store-system-stream.integration.test.ts.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createEntity, createTextField } from "../../engine";
import { AccessDeniedError } from "../../errors";
import {
  createTestDb,
  type TestDb,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
} from "../../stack";
import { createEventStoreExecutor } from "../event-store-executor";
import { buildEntityTable } from "../table-builder";
import { createTenantDb } from "../tenant-db";

const globalEntity = createEntity({
  table: "gtenancy_global",
  tenancy: "global",
  systemStream: true,
  fields: { name: createTextField({ required: true, personal: false, reason: "test_fixture" }) },
});

const globalTable = buildEntityTable("gtenancyGlobal", globalEntity);
const globalExec = createEventStoreExecutor(globalTable, globalEntity, {
  entityName: "gtenancyGlobal",
});

const user = TestUsers.admin; // tenantId === testTenantId(1)
const foreignTenantId = testTenantId(2);

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
  await unsafeCreateEntityTable(testDb.db, globalEntity, "gtenancyGlobal");
});

afterAll(async () => {
  await testDb.cleanup();
});

describe("global entity tenantId invariant (fw#2858)", () => {
  test("create with an explicit foreign tenantId throws AccessDeniedError", async () => {
    const db = createTenantDb(testDb.db, user.tenantId);
    await expect(
      globalExec.create({ name: "a", tenantId: foreignTenantId }, user, db),
    ).rejects.toBeInstanceOf(AccessDeniedError);
  });

  test("create without a tenantId (or SYSTEM) succeeds", async () => {
    const db = createTenantDb(testDb.db, user.tenantId);
    const res = await globalExec.create({ name: "a" }, user, db);
    expect(res.isSuccess).toBe(true);
  });

  test("update with an explicit foreign tenantId in changes throws AccessDeniedError", async () => {
    const db = createTenantDb(testDb.db, user.tenantId);
    const created = await globalExec.create({ name: "a" }, user, db);
    if (!created.isSuccess) throw new Error("create failed");

    await expect(
      globalExec.update(
        { id: String(created.data.id), changes: { tenantId: foreignTenantId } },
        user,
        db,
        { skipOptimisticLock: true },
      ),
    ).rejects.toBeInstanceOf(AccessDeniedError);
  });
});
