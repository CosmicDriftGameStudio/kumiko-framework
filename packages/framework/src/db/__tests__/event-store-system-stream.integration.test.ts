// #497 guard: an entity declared `systemStream: true` (tenant-independent, e.g.
// user) gets its event stream on SYSTEM_TENANT_ID for EVERY op; a normal entity
// stays on the caller's tenant (byte-identical to the old hardcoded user.tenantId).
// Routing is per-entity (createEntity flag), NOT inherited from r.systemScope().

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createEntity, createTextField } from "../../engine";
import { SYSTEM_TENANT_ID } from "../../engine/types/identifiers";
import { eventsTable } from "../../event-store";
import {
  createTestDb,
  type TestDb,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
} from "../../stack";
import { createEventStoreExecutor } from "../event-store-executor";
import { selectMany } from "../query";
import { buildEntityTable } from "../table-builder";
import { createTenantDb } from "../tenant-db";

const systemEntity = createEntity({
  table: "sstream_sys",
  systemStream: true,
  fields: { name: createTextField({ required: true }) },
});
const tenantOwnedEntity = createEntity({
  table: "sstream_tn",
  fields: { name: createTextField({ required: true }) },
});

const systemTable = buildEntityTable("sstreamSys", systemEntity);
const tenantTable = buildEntityTable("sstreamTn", tenantOwnedEntity);
const systemExec = createEventStoreExecutor(systemTable, systemEntity, {
  entityName: "sstreamSys",
});
const tenantExec = createEventStoreExecutor(tenantTable, tenantOwnedEntity, {
  entityName: "sstreamTn",
});

const user = TestUsers.admin; // tenantId === testTenantId(1)

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
  await unsafeCreateEntityTable(testDb.db, systemEntity, "sstreamSys");
  await unsafeCreateEntityTable(testDb.db, tenantOwnedEntity, "sstreamTn");
});

afterAll(async () => {
  await testDb.cleanup();
});

async function eventTenantIds(aggregateId: string): Promise<string[]> {
  const rows = await selectMany(testDb.db, eventsTable, { aggregateId });
  return rows.map((r) => r!["tenantId"] as string);
}

describe("systemStream stream-tenant routing (#497)", () => {
  test("systemStream entity: created event lands on SYSTEM_TENANT_ID", async () => {
    const db = createTenantDb(testDb.db, user.tenantId);
    const res = await systemExec.create({ name: "a" }, user, db);
    expect(res.isSuccess).toBe(true);
    if (!res.isSuccess) throw new Error("create failed");

    expect(await eventTenantIds(String(res.data.id))).toEqual([SYSTEM_TENANT_ID]);
  });

  test("systemStream entity: update addresses the SYSTEM stream (every op routes)", async () => {
    const db = createTenantDb(testDb.db, user.tenantId);
    const created = await systemExec.create({ name: "a" }, user, db);
    if (!created.isSuccess) throw new Error("create failed");
    const id = String(created.data.id);

    // If update addressed user.tenantId instead of SYSTEM, getStreamVersion
    // would read 0 and the append would version-conflict. Success proves the
    // whole addressing path (not just create) routes to SYSTEM.
    const updated = await systemExec.update({ id, changes: { name: "b" } }, user, db, {
      skipOptimisticLock: true,
    });
    expect(updated.isSuccess).toBe(true);
    expect(await eventTenantIds(id)).toEqual([SYSTEM_TENANT_ID, SYSTEM_TENANT_ID]);
  });

  test("normal entity: created event lands on the caller's tenant (unchanged)", async () => {
    const db = createTenantDb(testDb.db, user.tenantId);
    const res = await tenantExec.create({ name: "a" }, user, db);
    expect(res.isSuccess).toBe(true);
    if (!res.isSuccess) throw new Error("create failed");

    const ids = await eventTenantIds(String(res.data.id));
    expect(ids).toEqual([testTenantId(1)]);
    expect(ids).not.toContain(SYSTEM_TENANT_ID);
  });
});
