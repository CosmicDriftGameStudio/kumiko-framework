// #3607 — streamTenantId addresses another tenant's stream without rewriting the acting user.
// Only a system-mode db or a tenant-mode db bound to that stream tenant may use it, and only for the tenant of the row it loaded.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { selectMany } from "../../db/query.js";
import { createEntity, createTextField } from "../../engine/index.js";
import { eventsTable } from "../../event-store/index.js";
import {
  createTestDb,
  type TestDb,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
} from "../../stack/index.js";
import { createEventStoreExecutor } from "../event-store-executor.js";
import { buildEntityTable } from "../table-builder.js";
import { createTenantDb } from "../tenant-db.js";

const noteEntity = createEntity({
  table: "streamtenant_notes",
  fields: { label: createTextField({ required: true, personal: false, reason: "test_fixture" }) },
});
const noteTable = buildEntityTable("streamNote", noteEntity);
const noteExec = createEventStoreExecutor(noteTable, noteEntity, { entityName: "streamNote" });

const owner = TestUsers.otherTenant;
const operator = TestUsers.systemAdmin;
const ownerTenantId = testTenantId(2);

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
  await unsafeCreateEntityTable(testDb.db, noteEntity, "streamNote");
});

afterAll(async () => {
  await testDb.cleanup();
});

async function createOwnerRow(): Promise<string> {
  const created = await noteExec.create(
    { label: "before" },
    owner,
    createTenantDb(testDb.db, owner.tenantId),
  );
  if (!created.isSuccess) throw new Error("create failed");
  return String(created.data.id);
}

describe("executor streamTenantId (#3607)", () => {
  test("a system-mode db writes to the row's stream with the operator as actor", async () => {
    const id = await createOwnerRow();
    const systemDb = createTenantDb(testDb.db, operator.tenantId, "system");

    const updated = await noteExec.update({ id, changes: { label: "after" } }, operator, systemDb, {
      skipOptimisticLock: true,
      streamTenantId: ownerTenantId,
    });
    expect(updated.isSuccess).toBe(true);

    const events = await selectMany<{ type: string; tenantId: string; createdBy: string }>(
      testDb.db,
      eventsTable,
      { aggregateId: id },
    );
    const updateEvent = events.find((event) => event.type.includes("updated"));
    expect(updateEvent?.tenantId).toBe(ownerTenantId);
    expect(updateEvent?.createdBy).toBe(operator.id);
  });

  test("a streamTenantId that is not the row's tenant is refused and nothing is written", async () => {
    const id = await createOwnerRow();
    const systemDb = createTenantDb(testDb.db, operator.tenantId, "system");

    const result = await noteExec.update({ id, changes: { label: "wrong" } }, operator, systemDb, {
      skipOptimisticLock: true,
      streamTenantId: testTenantId(3),
    });
    expect(result.isSuccess).toBe(false);
    if (!result.isSuccess) expect(result.error.code).toBe("access_denied");

    const events = await selectMany<{ type: string }>(testDb.db, eventsTable, { aggregateId: id });
    expect(events.some((event) => event.type.includes("updated"))).toBe(false);
  });

  test("a tenant-mode db bound to a different tenant may not address the stream", async () => {
    const otherTenantDb = createTenantDb(testDb.db, testTenantId(3));
    const eventsBefore = await selectMany(testDb.db, eventsTable);

    const created = await noteExec.create({ label: "nope" }, operator, otherTenantDb, {
      streamTenantId: ownerTenantId,
    });
    expect(created.isSuccess).toBe(false);
    if (!created.isSuccess) expect(created.error.code).toBe("access_denied");
    expect(await selectMany(testDb.db, eventsTable)).toHaveLength(eventsBefore.length);
  });

  test("an update through a db bound to another tenant cannot even see the row", async () => {
    const id = await createOwnerRow();
    const otherTenantDb = createTenantDb(testDb.db, testTenantId(3));

    const result = await noteExec.update(
      { id, changes: { label: "nope" } },
      operator,
      otherTenantDb,
      { skipOptimisticLock: true, streamTenantId: ownerTenantId },
    );
    expect(result.isSuccess).toBe(false);
    if (!result.isSuccess) expect(result.error.code).toBe("not_found");
    const events = await selectMany<{ type: string }>(testDb.db, eventsTable, { aggregateId: id });
    expect(events.some((event) => event.type.includes("updated"))).toBe(false);
  });

  test("a tenant-mode db bound to the stream tenant carries the override with the operator as actor", async () => {
    const id = await createOwnerRow();
    const ownerTenantDb = createTenantDb(testDb.db, ownerTenantId);

    const updated = await noteExec.update(
      { id, changes: { label: "via-tenant-db" } },
      operator,
      ownerTenantDb,
      { skipOptimisticLock: true, streamTenantId: ownerTenantId },
    );
    expect(updated.isSuccess).toBe(true);

    const events = await selectMany<{ type: string; tenantId: string; createdBy: string }>(
      testDb.db,
      eventsTable,
      { aggregateId: id },
    );
    const updateEvent = events.find((event) => event.type.includes("updated"));
    expect(updateEvent?.tenantId).toBe(ownerTenantId);
    expect(updateEvent?.createdBy).toBe(operator.id);
  });

  test("create on a system-mode db lands in the target stream with the operator as actor", async () => {
    const systemDb = createTenantDb(testDb.db, operator.tenantId, "system");

    const created = await noteExec.create({ label: "into-owner" }, operator, systemDb, {
      streamTenantId: ownerTenantId,
    });
    expect(created.isSuccess).toBe(true);
    if (!created.isSuccess) return;
    const id = String(created.data.id);

    const events = await selectMany<{ type: string; tenantId: string; createdBy: string }>(
      testDb.db,
      eventsTable,
      { aggregateId: id },
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.tenantId).toBe(ownerTenantId);
    expect(events[0]?.createdBy).toBe(operator.id);

    const rows = await selectMany<{ tenantId: string }>(testDb.db, noteTable, { id });
    expect(rows[0]?.tenantId).toBe(ownerTenantId);
  });

  test("create refuses a payload tenantId that differs from streamTenantId", async () => {
    const systemDb = createTenantDb(testDb.db, operator.tenantId, "system");

    const result = await noteExec.create(
      { label: "mismatch", tenantId: testTenantId(3) },
      operator,
      systemDb,
      { streamTenantId: ownerTenantId },
    );
    expect(result.isSuccess).toBe(false);
    if (!result.isSuccess) expect(result.error.code).toBe("access_denied");
  });

  test("create on a tenant-mode db bound to a different tenant may not address the stream", async () => {
    const tenantDb = createTenantDb(testDb.db, owner.tenantId);

    const result = await noteExec.create({ label: "nope" }, owner, tenantDb, {
      streamTenantId: testTenantId(3),
    });
    expect(result.isSuccess).toBe(false);
    if (!result.isSuccess) expect(result.error.code).toBe("access_denied");
  });
});
