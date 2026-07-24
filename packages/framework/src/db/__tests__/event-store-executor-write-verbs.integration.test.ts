// The five write-verbs (create/update/delete/forget/restore) have several
// error paths the existing suites (event-store-executor.integration.test.ts,
// unique-violation-mapping.integration.test.ts) don't touch: entity- and
// field-level ownership denials, explicit version conflicts, the forget()
// verb entirely, and restore()'s two precondition failures.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "../../db/query";
import { createEntity, createTextField } from "../../engine";
import { from } from "../../engine/ownership";
import { createEventsTable } from "../../event-store";
import type { EntityCache } from "../../pipeline/entity-cache";
import { createTestDb, type TestDb, TestUsers, unsafeCreateEntityTable } from "../../stack";
import { createEventStoreExecutor } from "../event-store-executor";
import { buildEntityTable } from "../table-builder";
import { createTenantDb, type TenantDb } from "../tenant-db";

let testDb: TestDb;
let tdb: TenantDb;
const admin = TestUsers.admin;
const nonAdmin = TestUsers.user;

beforeAll(async () => {
  testDb = await createTestDb();
  await createEventsTable(testDb.db);
  tdb = createTenantDb(testDb.db, admin.tenantId);
});

afterAll(async () => {
  await testDb.cleanup();
});

// =============================================================================
// entity-level ownership_denied — create/update/delete/forget/restore
// =============================================================================

const restrictedEntity = createEntity({
  table: "read_es_write_restricted",
  fields: {
    email: createTextField({ required: true }),
  },
  softDelete: true,
  access: { write: { Admin: "all" } },
});
const restrictedTable = buildEntityTable("esWriteRestricted", restrictedEntity);

describe("event-store-executor write-verbs — entity-level ownership_denied", () => {
  const crud = createEventStoreExecutor(restrictedTable, restrictedEntity, {
    entityName: "esWriteRestricted",
  });

  beforeAll(async () => {
    await unsafeCreateEntityTable(testDb.db, restrictedEntity, "esWriteRestricted");
  });

  beforeEach(async () => {
    await asRawClient(testDb.db).unsafe(
      `TRUNCATE kumiko_events, read_es_write_restricted RESTART IDENTITY CASCADE`,
    );
  });

  test("create: role without a write-rule → ownership_denied", async () => {
    const result = await crud.create({ email: "denied@test.de" }, nonAdmin, tdb);
    expect(result.isSuccess).toBe(false);
    if (result.isSuccess) return;
    expect((result.error.details as { reason?: string }).reason).toBe("ownership_denied");
  });

  test("update: role without a write-rule → ownership_denied", async () => {
    const created = await crud.create({ email: "owner@test.de" }, admin, tdb);
    if (!created.isSuccess) throw new Error("setup failed");

    const result = await crud.update(
      { id: created.data.id, version: 1, changes: { email: "changed@test.de" } },
      nonAdmin,
      tdb,
    );
    expect(result.isSuccess).toBe(false);
    if (result.isSuccess) return;
    expect((result.error.details as { reason?: string }).reason).toBe("ownership_denied");
  });

  test("delete: role without a write-rule → ownership_denied", async () => {
    const created = await crud.create({ email: "todelete@test.de" }, admin, tdb);
    if (!created.isSuccess) throw new Error("setup failed");

    const result = await crud.delete({ id: created.data.id }, nonAdmin, tdb);
    expect(result.isSuccess).toBe(false);
    if (result.isSuccess) return;
    expect((result.error.details as { reason?: string }).reason).toBe("ownership_denied");
  });

  test("forget: role without a write-rule → ownership_denied", async () => {
    const created = await crud.create({ email: "toforget@test.de" }, admin, tdb);
    if (!created.isSuccess) throw new Error("setup failed");

    const result = await crud.forget({ id: created.data.id }, nonAdmin, tdb);
    expect(result.isSuccess).toBe(false);
    if (result.isSuccess) return;
    expect((result.error.details as { reason?: string }).reason).toBe("ownership_denied");
  });

  test("forget: happy path hard-deletes the row and appends a forgotten event", async () => {
    const created = await crud.create({ email: "gone@test.de" }, admin, tdb);
    if (!created.isSuccess) throw new Error("setup failed");

    const result = await crud.forget({ id: created.data.id }, admin, tdb);
    expect(result.isSuccess).toBe(true);

    const rows = (await asRawClient(testDb.db).unsafe(
      `SELECT id FROM read_es_write_restricted WHERE email = 'gone@test.de'`,
    )) as unknown[];
    expect(rows).toHaveLength(0);

    const events = (await asRawClient(testDb.db).unsafe(
      `SELECT type FROM kumiko_events WHERE type = 'esWriteRestricted.forgotten'`,
    )) as unknown[];
    expect(events).toHaveLength(1);
  });

  test("restore: role without a write-rule → ownership_denied", async () => {
    const created = await crud.create({ email: "torestore@test.de" }, admin, tdb);
    if (!created.isSuccess) throw new Error("setup failed");
    await crud.delete({ id: created.data.id }, admin, tdb);

    const result = await crud.restore({ id: created.data.id }, nonAdmin, tdb);
    expect(result.isSuccess).toBe(false);
    if (result.isSuccess) return;
    expect((result.error.details as { reason?: string }).reason).toBe("ownership_denied");
  });

  test("restore: not yet deleted row → not_deleted", async () => {
    const created = await crud.create({ email: "notdeleted@test.de" }, admin, tdb);
    if (!created.isSuccess) throw new Error("setup failed");

    const result = await crud.restore({ id: created.data.id }, admin, tdb);
    expect(result.isSuccess).toBe(false);
    if (result.isSuccess) return;
    expect((result.error.details as { reason?: string }).reason).toBe("not_deleted");
  });
});

// =============================================================================
// restore() on a non-soft-delete entity → soft_delete_not_enabled
// =============================================================================

const hardDeleteEntity = createEntity({
  table: "read_es_write_hard",
  fields: {
    email: createTextField({ required: true }),
  },
});
const hardDeleteTable = buildEntityTable("esWriteHard", hardDeleteEntity);

describe("event-store-executor write-verbs — restore without softDelete", () => {
  const crud = createEventStoreExecutor(hardDeleteTable, hardDeleteEntity, {
    entityName: "esWriteHard",
  });

  beforeAll(async () => {
    await unsafeCreateEntityTable(testDb.db, hardDeleteEntity, "esWriteHard");
  });

  beforeEach(async () => {
    await asRawClient(testDb.db).unsafe(
      `TRUNCATE kumiko_events, read_es_write_hard RESTART IDENTITY CASCADE`,
    );
  });

  test("restore on an entity without softDelete → soft_delete_not_enabled", async () => {
    const created = await crud.create({ email: "hard@test.de" }, admin, tdb);
    if (!created.isSuccess) throw new Error("setup failed");

    const result = await crud.restore({ id: created.data.id }, admin, tdb);
    expect(result.isSuccess).toBe(false);
    if (result.isSuccess) return;
    expect((result.error.details as { reason?: string }).reason).toBe("soft_delete_not_enabled");
  });
});

// =============================================================================
// field-level ownership_denied — checkWriteFieldOwnership via a row-scoped rule
// =============================================================================

const ownedFieldEntity = createEntity({
  table: "read_es_write_owned_field",
  fields: {
    authorId: createTextField({ required: true }),
    note: createTextField({
      access: { write: { Admin: "all", User: from("user:id", "authorId") } },
    }),
  },
});
const ownedFieldTable = buildEntityTable("esWriteOwnedField", ownedFieldEntity);

describe("event-store-executor write-verbs — field-level ownership_denied", () => {
  const crud = createEventStoreExecutor(ownedFieldTable, ownedFieldEntity, {
    entityName: "esWriteOwnedField",
  });

  beforeAll(async () => {
    await unsafeCreateEntityTable(testDb.db, ownedFieldEntity, "esWriteOwnedField");
  });

  beforeEach(async () => {
    await asRawClient(testDb.db).unsafe(
      `TRUNCATE kumiko_events, read_es_write_owned_field RESTART IDENTITY CASCADE`,
    );
  });

  test("create: writing `note` while authorId names someone else → ownership_denied (field scope)", async () => {
    const result = await crud.create(
      { authorId: TestUsers.driver.id, note: "not mine" },
      nonAdmin,
      tdb,
    );
    expect(result.isSuccess).toBe(false);
    if (result.isSuccess) return;
    const details = result.error.details as { reason?: string; scope?: string; field?: string };
    expect(details.reason).toBe("ownership_denied");
    expect(details.scope).toBe("field");
    expect(details.field).toBe("note");
  });

  test("create: writing `note` as the named author succeeds", async () => {
    const result = await crud.create({ authorId: nonAdmin.id, note: "mine" }, nonAdmin, tdb);
    expect(result.isSuccess).toBe(true);
  });

  test("update: changing `note` on someone else's row → ownership_denied (field scope)", async () => {
    const created = await crud.create(
      { authorId: TestUsers.driver.id, note: "original" },
      admin,
      tdb,
    );
    if (!created.isSuccess) throw new Error("setup failed");

    const result = await crud.update(
      { id: created.data.id, version: 1, changes: { note: "hijacked" } },
      nonAdmin,
      tdb,
    );
    expect(result.isSuccess).toBe(false);
    if (result.isSuccess) return;
    expect((result.error.details as { reason?: string }).reason).toBe("ownership_denied");
  });
});

// =============================================================================
// version_conflict — explicit-id create collision, missing version on update
// =============================================================================

const versionEntity = createEntity({
  table: "read_es_write_version",
  fields: {
    email: createTextField({ required: true }),
  },
});
const versionTable = buildEntityTable("esWriteVersion", versionEntity);

describe("event-store-executor write-verbs — version_conflict edge cases", () => {
  const crud = createEventStoreExecutor(versionTable, versionEntity, {
    entityName: "esWriteVersion",
  });

  beforeAll(async () => {
    await unsafeCreateEntityTable(testDb.db, versionEntity, "esWriteVersion");
  });

  beforeEach(async () => {
    await asRawClient(testDb.db).unsafe(
      `TRUNCATE kumiko_events, read_es_write_version RESTART IDENTITY CASCADE`,
    );
  });

  test("create with an explicit id that already has a stream → version_conflict", async () => {
    const first = await crud.create({ email: "first@test.de" }, admin, tdb);
    if (!first.isSuccess) throw new Error("setup failed");

    const collision = await crud.create({ id: first.data.id, email: "second@test.de" }, admin, tdb);
    expect(collision.isSuccess).toBe(false);
    if (collision.isSuccess) return;
    expect(collision.error.code).toBe("version_conflict");
  });

  test("update without a version field (and no skipOptimisticLock) → version_conflict", async () => {
    const created = await crud.create({ email: "noversion@test.de" }, admin, tdb);
    if (!created.isSuccess) throw new Error("setup failed");

    const result = await crud.update(
      { id: created.data.id, changes: { email: "changed@test.de" } },
      admin,
      tdb,
    );
    expect(result.isSuccess).toBe(false);
    if (result.isSuccess) return;
    expect(result.error.code).toBe("version_conflict");
  });
});

// =============================================================================
// Concurrent update race → EventStoreVersionConflict catch + entityCache.del
// on forget/restore (create/update/delete already exercise cache in the
// main suite; forget/restore del() stayed uncovered).
// =============================================================================

const raceEntity = createEntity({
  table: "read_es_write_race",
  fields: {
    email: createTextField({ required: true }),
  },
  softDelete: true,
});
const raceTable = buildEntityTable("esWriteRace", raceEntity);

describe("event-store-executor write-verbs — concurrent version race + cache", () => {
  const store = new Map<string, Record<string, unknown>>();
  const entityCache: EntityCache = {
    get: async (tenantId, name, id) => store.get(`${tenantId}:${name}:${id}`) ?? null,
    mget: async () => new Map(),
    set: async (tenantId, name, id, data) => {
      store.set(`${tenantId}:${name}:${id}`, data);
    },
    mset: async (tenantId, name, entries) => {
      for (const { id, data } of entries) store.set(`${tenantId}:${name}:${id}`, data);
    },
    del: async (tenantId, name, id) => {
      store.delete(`${tenantId}:${name}:${id}`);
    },
  };
  const crud = createEventStoreExecutor(raceTable, raceEntity, {
    entityName: "esWriteRace",
    entityCache,
  });

  beforeAll(async () => {
    await unsafeCreateEntityTable(testDb.db, raceEntity, "esWriteRace");
  });

  beforeEach(async () => {
    store.clear();
    await asRawClient(testDb.db).unsafe(
      `TRUNCATE kumiko_events, read_es_write_race RESTART IDENTITY CASCADE`,
    );
  });

  test("two concurrent updates with the same version → one wins, one version_conflict", async () => {
    const created = await crud.create({ email: "race@test.de" }, admin, tdb);
    if (!created.isSuccess) throw new Error("setup failed");
    const id = created.data.id;

    const [a, b] = await Promise.all([
      crud.update({ id, version: 1, changes: { email: "a@test.de" } }, admin, tdb),
      crud.update({ id, version: 1, changes: { email: "b@test.de" } }, admin, tdb),
    ]);

    const results = [a, b];
    expect(results.filter((r) => r.isSuccess)).toHaveLength(1);
    expect(results.filter((r) => !r.isSuccess && r.error.code === "version_conflict")).toHaveLength(
      1,
    );
  });

  test("forget with entityCache clears the cache entry", async () => {
    const created = await crud.create({ email: "cache-forget@test.de" }, admin, tdb);
    if (!created.isSuccess) throw new Error("setup failed");
    const id = created.data.id;
    const key = `${admin.tenantId}:esWriteRace:${id}`;
    store.set(key, { email: "poison" });

    const result = await crud.forget({ id }, admin, tdb);
    expect(result.isSuccess).toBe(true);
    expect(store.has(key)).toBe(false);
  });

  test("restore with entityCache clears the cache entry", async () => {
    const created = await crud.create({ email: "cache-restore@test.de" }, admin, tdb);
    if (!created.isSuccess) throw new Error("setup failed");
    const id = created.data.id;
    await crud.delete({ id }, admin, tdb);

    const key = `${admin.tenantId}:esWriteRace:${id}`;
    store.set(key, { email: "poison" });

    const result = await crud.restore({ id }, admin, tdb);
    expect(result.isSuccess).toBe(true);
    expect(store.has(key)).toBe(false);
  });
});
