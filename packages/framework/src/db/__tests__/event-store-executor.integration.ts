import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { asRawClient } from "../../bun-db/query";
import { createBooleanField, createEntity, createTextField } from "../../engine";
import { createEventsTable } from "../../event-store";
import {
  createTestDb,
  type TestDb,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
} from "../../stack";
import { createEventStoreExecutor } from "../event-store-executor";
import { buildEntityTable } from "../table-builder";
import { createTenantDb, type TenantDb } from "../tenant-db";

const entity = createEntity({
  table: "read_es_exec_users",
  fields: {
    email: createTextField({ required: true, searchable: true }),
    firstName: createTextField(),
    isEnabled: createBooleanField({ default: true }),
  },
  softDelete: true,
});
const table = buildEntityTable("esExecUser", entity);

let testDb: TestDb;
let tdb: TenantDb;
const adminUser = TestUsers.admin;

beforeAll(async () => {
  testDb = await createTestDb();
  await unsafeCreateEntityTable(testDb.db, entity, "esExecUser");
  await createEventsTable(testDb.db);
  tdb = createTenantDb(testDb.db, adminUser.tenantId);
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await asRawClient(testDb.db).unsafe(
    `TRUNCATE kumiko_events, read_es_exec_users RESTART IDENTITY CASCADE`,
  );
});

describe("event-store-executor", () => {
  const crud = createEventStoreExecutor(table, entity, { entityName: "esExecUser" });

  test("create appends event v1 + inserts projection row", async () => {
    const result = await crud.create({ email: "test@test.de", firstName: "Test" }, adminUser, tdb);
    expect(result.isSuccess).toBe(true);
    if (!result.isSuccess) return;
    expect(result.data.isNew).toBe(true);
    expect(typeof result.data.id).toBe("string");
    expect(result.data.data["email"]).toBe("test@test.de");
    expect(result.data.data["tenantId"]).toBe(testTenantId(1));
    expect(result.data.data["version"]).toBe(1);
  });

  test("update increments version + appends event", async () => {
    const created = await crud.create({ email: "u@test.de" }, adminUser, tdb);
    if (!created.isSuccess) throw new Error("setup failed");

    const result = await crud.update(
      { id: created.data.id, version: 1, changes: { firstName: "Updated" } },
      adminUser,
      tdb,
    );
    expect(result.isSuccess).toBe(true);
    if (!result.isSuccess) return;
    expect(result.data.data["version"]).toBe(2);
    expect(result.data.data["firstName"]).toBe("Updated");
  });

  test("stale version → version_conflict", async () => {
    const created = await crud.create({ email: "v@test.de" }, adminUser, tdb);
    if (!created.isSuccess) throw new Error("setup failed");

    await crud.update(
      { id: created.data.id, version: 1, changes: { firstName: "First" } },
      adminUser,
      tdb,
    );
    const stale = await crud.update(
      { id: created.data.id, version: 1, changes: { firstName: "Stale" } },
      adminUser,
      tdb,
    );
    expect(stale.isSuccess).toBe(false);
    if (stale.isSuccess) return;
    expect(stale.error.code).toBe("version_conflict");
  });

  test("delete soft-deletes + appends event", async () => {
    const created = await crud.create({ email: "d@test.de" }, adminUser, tdb);
    if (!created.isSuccess) throw new Error("setup failed");

    const deleted = await crud.delete({ id: created.data.id }, adminUser, tdb);
    expect(deleted.isSuccess).toBe(true);

    const detail = await crud.detail({ id: created.data.id }, adminUser, tdb);
    expect(detail).toBeNull();
  });
});

// Sensitive-field stripping: passwords/tokens/IBANs stay in the entity row
// but MUST NOT land in the immutable event log (GDPR right-to-be-forgotten,
// secrets-rotation, audit discoverability). Fields marked `sensitive: true`
// are excluded from every event payload: create data, update changes,
// update previous, delete previous, restore previous.
const sensitiveEntity = createEntity({
  table: "read_es_exec_sensitive",
  fields: {
    email: createTextField({ required: true }),
    passwordHash: createTextField({ sensitive: true }),
    apiToken: createTextField({ sensitive: true }),
  },
  softDelete: true,
});
const sensitiveTable = buildEntityTable("esExecSensitive", sensitiveEntity);

describe("event-store-executor — sensitive fields", () => {
  const crud = createEventStoreExecutor(sensitiveTable, sensitiveEntity, {
    entityName: "esExecSensitive",
  });

  beforeAll(async () => {
    await unsafeCreateEntityTable(testDb.db, sensitiveEntity, "esExecSensitive");
  });

  beforeEach(async () => {
    await asRawClient(testDb.db).unsafe(
      `TRUNCATE kumiko_events, read_es_exec_sensitive RESTART IDENTITY CASCADE`,
    );
  });

  async function lastEvent<TPayload = Record<string, unknown>>(): Promise<{
    type: string;
    payload: TPayload;
  }> {
    const rows = await asRawClient(testDb.db).unsafe(
      `SELECT type, payload FROM kumiko_events ORDER BY id DESC LIMIT 1`,
    );
    const row = rows[0];
    if (!row) throw new Error("no events in store");
    return row as { type: string; payload: TPayload };
  }

  test("create event payload excludes sensitive fields but entity row keeps them", async () => {
    const result = await crud.create(
      { email: "s@test.de", passwordHash: "pw-hash-123", apiToken: "tok-abc" },
      adminUser,
      tdb,
    );
    if (!result.isSuccess) throw new Error("create failed");
    // Entity row: full data preserved.
    expect(result.data.data["passwordHash"]).toBe("pw-hash-123");
    expect(result.data.data["apiToken"]).toBe("tok-abc");

    // Event payload: sensitive stripped, public retained.
    const event = await lastEvent();
    expect(event.type).toBe("esExecSensitive.created");
    expect(event.payload["email"]).toBe("s@test.de");
    expect(event.payload["passwordHash"]).toBeUndefined();
    expect(event.payload["apiToken"]).toBeUndefined();
  });

  test("update event strips sensitive from BOTH changes and previous", async () => {
    const created = await crud.create(
      { email: "u@test.de", passwordHash: "old-hash", apiToken: "old-tok" },
      adminUser,
      tdb,
    );
    if (!created.isSuccess) throw new Error("create failed");

    const result = await crud.update(
      {
        id: created.data.id,
        version: 1,
        changes: { passwordHash: "new-hash", email: "u2@test.de" },
      },
      adminUser,
      tdb,
    );
    if (!result.isSuccess) throw new Error("update failed");

    const event = await lastEvent<{
      changes: { email?: string; passwordHash?: string };
      previous: { email?: string; passwordHash?: string; apiToken?: string };
    }>();
    expect(event.type).toBe("esExecSensitive.updated");
    // Changes: email retained (public), passwordHash stripped.
    expect(event.payload.changes.email).toBe("u2@test.de");
    expect(event.payload.changes.passwordHash).toBeUndefined();
    // Previous: email retained, passwordHash + apiToken stripped.
    expect(event.payload.previous.email).toBe("u@test.de");
    expect(event.payload.previous.passwordHash).toBeUndefined();
    expect(event.payload.previous.apiToken).toBeUndefined();
  });

  test("delete event strips sensitive from previous", async () => {
    const created = await crud.create(
      { email: "d@test.de", passwordHash: "pw", apiToken: "tk" },
      adminUser,
      tdb,
    );
    if (!created.isSuccess) throw new Error("create failed");

    await crud.delete({ id: created.data.id }, adminUser, tdb);

    type SensitivePrevious = {
      previous: { email?: string; passwordHash?: string; apiToken?: string };
    };
    const event = await lastEvent<SensitivePrevious>();
    expect(event.type).toBe("esExecSensitive.deleted");
    expect(event.payload.previous.email).toBe("d@test.de");
    expect(event.payload.previous.passwordHash).toBeUndefined();
    expect(event.payload.previous.apiToken).toBeUndefined();
  });

  test("restore event strips sensitive from previous", async () => {
    const created = await crud.create(
      { email: "r@test.de", passwordHash: "pw", apiToken: "tk" },
      adminUser,
      tdb,
    );
    if (!created.isSuccess) throw new Error("create failed");
    await crud.delete({ id: created.data.id }, adminUser, tdb);

    await crud.restore({ id: created.data.id }, adminUser, tdb);

    type SensitivePrevious = {
      previous: { email?: string; passwordHash?: string; apiToken?: string };
    };
    const event = await lastEvent<SensitivePrevious>();
    expect(event.type).toBe("esExecSensitive.restored");
    expect(event.payload.previous.email).toBe("r@test.de");
    expect(event.payload.previous.passwordHash).toBeUndefined();
    expect(event.payload.previous.apiToken).toBeUndefined();
  });
});
