// The five write-verbs (create/update/delete/forget/restore) have several
// error paths the existing suites (event-store-executor.integration.test.ts,
// unique-violation-mapping.integration.test.ts) don't touch: entity- and
// field-level ownership denials, explicit version conflicts, the forget()
// verb entirely, and restore()'s two precondition failures.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient, transaction } from "../../db/query";
import { createEntity, createTextField } from "../../engine";
import { from } from "../../engine/ownership";
import { createSystemUser } from "../../engine/system-user";
import { createEventsTable } from "../../event-store";
import type { EntityCache } from "../../pipeline/entity-cache";
import {
  createTestDb,
  createTestUser,
  type TestDb,
  TestUsers,
  unsafeCreateEntityTable,
} from "../../stack";
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
    email: createTextField({ required: true, personal: false, reason: "test_fixture" }),
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

  test("forget: framework system user bypasses ownership (fw#2639 — GDPR erasure runs as SYSTEM)", async () => {
    const created = await crud.create({ email: "erase-me@test.de" }, admin, tdb);
    if (!created.isSuccess) throw new Error("setup failed");

    const systemUser = createSystemUser(admin.tenantId);
    const result = await crud.forget({ id: created.data.id }, systemUser, tdb);
    expect(result.isSuccess).toBe(true);

    const rows = (await asRawClient(testDb.db).unsafe(
      `SELECT id FROM read_es_write_restricted WHERE email = 'erase-me@test.de'`,
    )) as unknown[];
    expect(rows).toHaveLength(0);

    const events = (await asRawClient(testDb.db).unsafe(
      `SELECT type FROM kumiko_events WHERE type = 'esWriteRestricted.forgotten' AND aggregate_id = $1`,
      [String(created.data.id)],
    )) as unknown[];
    expect(events).toHaveLength(1);
  });

  test('forget: a role named "system" that isn\'t the framework SYSTEM_USER_ID is still denied', async () => {
    // Proves the bypass is keyed on the id, not just the role name — a
    // tenant-defined "system" role must not get an accidental Art.17
    // shortcut around access.write.
    const created = await crud.create({ email: "not-system@test.de" }, admin, tdb);
    if (!created.isSuccess) throw new Error("setup failed");

    const impostor = createTestUser({ id: 42, roles: ["system"] });
    const result = await crud.forget({ id: created.data.id }, impostor, tdb);
    expect(result.isSuccess).toBe(false);
    if (result.isSuccess) return;
    expect((result.error.details as { reason?: string }).reason).toBe("ownership_denied");
  });

  test("restore: role without a write-rule → ownership_denied", async () => {
    const created = await crud.create({ email: "torestore@test.de" }, admin, tdb);
    if (!created.isSuccess) throw new Error("setup failed");
    const deleted = await crud.delete({ id: created.data.id }, admin, tdb);
    if (!deleted.isSuccess) throw new Error("setup failed: delete");

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
    email: createTextField({ required: true, personal: false, reason: "test_fixture" }),
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
    authorId: createTextField({ personal: false, reason: "test_fixture", required: true }),
    note: createTextField({
      personal: false,
      reason: "test_fixture",
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

  // fw#1685: a preSave hook that derives a field the user never submitted
  // must not have that field field-ownership-checked against the user —
  // only what the user actually wrote in `payload.changes` is checked.
  test("create: preSave-derived `note` (not submitted by the user) does not trigger ownership_denied", async () => {
    const result = await crud.create({ authorId: TestUsers.driver.id }, nonAdmin, tdb, {
      preSave: async (changes) => ({ ...changes, note: "hook-derived" }),
    });
    expect(result.isSuccess).toBe(true);
  });

  test("update: preSave-derived `note` (not submitted by the user) does not trigger ownership_denied", async () => {
    const created = await crud.create(
      { authorId: TestUsers.driver.id, note: "original" },
      admin,
      tdb,
    );
    if (!created.isSuccess) throw new Error("setup failed");

    const result = await crud.update(
      { id: created.data.id, version: 1, changes: {} },
      nonAdmin,
      tdb,
      { preSave: async (changes) => ({ ...changes, note: "hook-derived" }) },
    );
    expect(result.isSuccess).toBe(true);
  });

  // Review-fix (kumiko-framework#1685): a preSave hook that echoes `id`/
  // `version` back in its return value must not have those leak into the
  // persisted row — the framework-minted aggregateId stays authoritative.
  test("create: preSave hook returning `id`/`version` does not override the minted aggregateId", async () => {
    const result = await crud.create({ authorId: nonAdmin.id, note: "mine" }, nonAdmin, tdb, {
      preSave: async (changes) => ({ ...changes, id: "hook-injected-id", version: 999 }),
    });
    expect(result.isSuccess).toBe(true);
    if (!result.isSuccess) return;
    expect(result.data.id).not.toBe("hook-injected-id");

    const row = await asRawClient(testDb.db).unsafe(
      `SELECT id FROM read_es_write_owned_field WHERE id = $1`,
      [result.data.id],
    );
    expect(row.length).toBe(1);
  });
});

// =============================================================================
// version_conflict — explicit-id create collision, missing version on update
// =============================================================================

const versionEntity = createEntity({
  table: "read_es_write_version",
  fields: {
    email: createTextField({ required: true, personal: false, reason: "test_fixture" }),
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
// expect precondition (kumiko-framework#3024) — declarative "genau einmal"
// guard on update(). The version_conflict describe above proves the pre-
// existing stream-version race protection; these prove `expect:` closes the
// gap that leaves open: a caller (like updateUserLifecycle) that opts out of
// the optimistic lock entirely, so a "late" writer whose own version read is
// fresh never trips version_conflict at all.
// =============================================================================

const expectEntity = createEntity({
  table: "read_es_write_expect",
  fields: {
    email: createTextField({ required: true, personal: false, reason: "test_fixture" }),
    status: createTextField({ personal: false, reason: "test_fixture" }),
    note: createTextField({ personal: false, reason: "test_fixture" }),
  },
});
const expectTable = buildEntityTable("esWriteExpect", expectEntity);

describe("event-store-executor write-verbs — expect precondition (#3024)", () => {
  const crud = createEventStoreExecutor(expectTable, expectEntity, {
    entityName: "esWriteExpect",
  });

  beforeAll(async () => {
    await unsafeCreateEntityTable(testDb.db, expectEntity, "esWriteExpect");
  });

  beforeEach(async () => {
    await asRawClient(testDb.db).unsafe(
      `TRUNCATE kumiko_events, read_es_write_expect RESTART IDENTITY CASCADE`,
    );
  });

  test("expect matching the fresh row → applies", async () => {
    const created = await crud.create({ email: "match@test.de", status: "Active" }, admin, tdb);
    if (!created.isSuccess) throw new Error("setup failed");

    const result = await crud.update(
      { id: created.data.id, changes: { status: "Requested" } },
      admin,
      tdb,
      { skipOptimisticLock: true, expect: { status: "Active" } },
    );
    expect(result.isSuccess).toBe(true);
  });

  test("expect not matching the fresh row → precondition_failed, row unchanged", async () => {
    const created = await crud.create({ email: "stale@test.de", status: "Requested" }, admin, tdb);
    if (!created.isSuccess) throw new Error("setup failed");

    const result = await crud.update(
      { id: created.data.id, changes: { status: "Deleted" } },
      admin,
      tdb,
      { skipOptimisticLock: true, expect: { status: "Active" } },
    );
    expect(result.isSuccess).toBe(false);
    if (result.isSuccess) return;
    expect(result.error.code).toBe("precondition_failed");

    const row = await asRawClient(testDb.db).unsafe(
      `SELECT status FROM read_es_write_expect WHERE id = $1`,
      [created.data.id],
    );
    expect((row as unknown as { status: string }[])[0]?.status).toBe("Requested");
  });

  test("multiple expect fields, one mismatches → precondition_failed", async () => {
    const created = await crud.create(
      { email: "multi@test.de", status: "Active", note: "kept" },
      admin,
      tdb,
    );
    if (!created.isSuccess) throw new Error("setup failed");

    const result = await crud.update(
      { id: created.data.id, changes: { status: "Requested" } },
      admin,
      tdb,
      { skipOptimisticLock: true, expect: { status: "Active", note: "different" } },
    );
    expect(result.isSuccess).toBe(false);
    if (result.isSuccess) return;
    expect(result.error.code).toBe("precondition_failed");
  });

  test("expect: null matches a null field, rejects a non-null one", async () => {
    const withNullNote = await crud.create({ email: "null-note@test.de" }, admin, tdb);
    if (!withNullNote.isSuccess) throw new Error("setup failed");
    const matched = await crud.update(
      { id: withNullNote.data.id, changes: { note: "now set" } },
      admin,
      tdb,
      { skipOptimisticLock: true, expect: { note: null } },
    );
    expect(matched.isSuccess).toBe(true);

    const withNote = await crud.create(
      { email: "present-note@test.de", note: "present" },
      admin,
      tdb,
    );
    if (!withNote.isSuccess) throw new Error("setup failed");
    const rejected = await crud.update(
      { id: withNote.data.id, changes: { note: "overwritten" } },
      admin,
      tdb,
      { skipOptimisticLock: true, expect: { note: null } },
    );
    expect(rejected.isSuccess).toBe(false);
  });

  // The scenario version_conflict alone can't catch: both callers skip the
  // optimistic lock (updateUserLifecycle's shape), so the second caller's own
  // stream-version read is fresh and never collides — only the fresh expect
  // re-read at write time sees that the first caller already moved the row on.
  test("late writer: expect catches a precondition an earlier write already violated, with no version race", async () => {
    const created = await crud.create({ email: "late@test.de", status: "Active" }, admin, tdb);
    if (!created.isSuccess) throw new Error("setup failed");
    const id = created.data.id;

    const first = await crud.update({ id, changes: { status: "Requested" } }, admin, tdb, {
      skipOptimisticLock: true,
      expect: { status: "Active" },
    });
    expect(first.isSuccess).toBe(true);

    const second = await crud.update({ id, changes: { status: "Requested" } }, admin, tdb, {
      skipOptimisticLock: true,
      expect: { status: "Active" },
    });
    expect(second.isSuccess).toBe(false);
    if (second.isSuccess) return;
    expect(second.error.code).toBe("precondition_failed");
  });

  // Wrapped in its own transaction per racer, like "two concurrent first-time
  // creates ... inside a transaction" above — this is how the dispatcher
  // always calls update() in production (the whole handler runs in one
  // transaction), and it matters here: without it, a single writer's own
  // event-append and projection-update commit as two SEPARATE, independently
  // visible statements against the bare pool, so a second reader can
  // observe "event committed, projection not yet" — a torn state that
  // doesn't exist once both writes commit together as one transaction. The
  // HTTP-level equivalent (anonymous-deletion.integration.test.ts, real
  // dispatcher, real transaction) already covers the true production
  // guarantee; this test pins the same guarantee at the executor level with
  // an explicit transaction to match.
  test("two concurrent updates with the same expect, both skipOptimisticLock → exactly one applies", async () => {
    const created = await crud.create(
      { email: "race-expect@test.de", status: "Active" },
      admin,
      tdb,
    );
    if (!created.isSuccess) throw new Error("setup failed");
    const id = created.data.id;
    const options = { skipOptimisticLock: true, expect: { status: "Active" } } as const;

    const [a, b] = await Promise.all([
      transaction(testDb.db, (tx) =>
        crud.update(
          { id, changes: { status: "Requested" } },
          admin,
          createTenantDb(tx, admin.tenantId),
          options,
        ),
      ),
      transaction(testDb.db, (tx) =>
        crud.update(
          { id, changes: { status: "Requested" } },
          admin,
          createTenantDb(tx, admin.tenantId),
          options,
        ),
      ),
    ]);

    const results = [a, b];
    expect(results.filter((r) => r.isSuccess)).toHaveLength(1);
    const loser = results.find((r) => !r.isSuccess);
    if (!loser || loser.isSuccess) throw new Error("expected exactly one loser");
    expect(["precondition_failed", "version_conflict"]).toContain(loser.error.code);

    const healthCheck = (await asRawClient(testDb.db).unsafe(`SELECT 1 AS ok`)) as Array<{
      ok: number;
    }>;
    expect(healthCheck[0]?.ok).toBe(1);
  });
});

// =============================================================================
// Explicit-id create: cross-tenant isolation, no resurrection of a deleted row
// =============================================================================

const deletedIdEntity = createEntity({
  table: "read_es_write_deleted_id",
  fields: {
    email: createTextField({ required: true, personal: false, reason: "test_fixture" }),
  },
  softDelete: true,
});
const deletedIdTable = buildEntityTable("esWriteDeletedId", deletedIdEntity);

describe("event-store-executor write-verbs — explicit-id tenant isolation + soft-delete", () => {
  const crud = createEventStoreExecutor(deletedIdTable, deletedIdEntity, {
    entityName: "esWriteDeletedId",
  });
  let otherTenantDb: TenantDb;

  beforeAll(async () => {
    await unsafeCreateEntityTable(testDb.db, deletedIdEntity, "esWriteDeletedId");
    otherTenantDb = createTenantDb(testDb.db, TestUsers.otherTenant.tenantId);
  });

  beforeEach(async () => {
    await asRawClient(testDb.db).unsafe(
      `TRUNCATE kumiko_events, read_es_write_deleted_id RESTART IDENTITY CASCADE`,
    );
  });

  test("create with an id already used by another tenant → conflict, tenant A's row untouched, no leak", async () => {
    // The event log itself is tenant-scoped (UNIQUE (tenant_id, aggregate_id,
    // version)) and would happily let tenant B open its own stream at the
    // same id — but every entity's projection table has a plain `id` primary
    // key (table-builder.ts), shared across all tenants for that entity
    // type. So a same-id create for a different tenant fails at the
    // projection-insert step with `unique_violation`, not `version_conflict`
    // — a different, still-typed error, and the mapped error's details carry
    // only entityName/constraintName, nothing that identifies tenant A's row.
    const first = await crud.create({ email: "tenant-a@test.de" }, admin, tdb);
    if (!first.isSuccess) throw new Error("setup failed");

    const other = await crud.create(
      { id: first.data.id, email: "tenant-b@test.de" },
      TestUsers.otherTenant,
      otherTenantDb,
    );
    expect(other.isSuccess).toBe(false);
    if (other.isSuccess) return;
    expect(other.error.code).toBe("unique_violation");
    expect(JSON.stringify(other.error.details)).not.toContain(admin.tenantId);

    const row = await asRawClient(testDb.db).unsafe(
      `SELECT email FROM read_es_write_deleted_id WHERE id = $1`,
      [first.data.id],
    );
    expect((row as unknown as { email: string }[])[0]?.email).toBe("tenant-a@test.de");
  });

  test("create with the id of a soft-deleted row → version_conflict, no resurrection", async () => {
    const created = await crud.create({ email: "gone@test.de" }, admin, tdb);
    if (!created.isSuccess) throw new Error("setup failed");

    const deleted = await crud.delete({ id: created.data.id }, admin, tdb);
    expect(deleted.isSuccess).toBe(true);

    const resurrect = await crud.create(
      { id: created.data.id, email: "back-from-the-dead@test.de" },
      admin,
      tdb,
    );
    expect(resurrect.isSuccess).toBe(false);
    if (resurrect.isSuccess) return;
    expect(resurrect.error.code).toBe("version_conflict");
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
    email: createTextField({ required: true, personal: false, reason: "test_fixture" }),
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

    // Guard against the known Bun.SQL pooled-connection-poisoning class: the
    // losing update above provoked a real 23505 unique-violation on the
    // shared pool. The two tests below this one reuse `tdb`/`testDb.db`, so
    // a poisoned connection would surface as their unrelated queries
    // failing — a trivial round-trip here catches that immediately instead
    // of leaving it to whichever later test happens to hit the bad
    // connection.
    const healthCheck = (await asRawClient(testDb.db).unsafe(`SELECT 1 AS ok`)) as Array<{
      ok: number;
    }>;
    expect(healthCheck[0]?.ok).toBe(1);
  });

  // kumiko-framework#1778 — a real write handler runs create() inside the
  // dispatcher's transaction (sql.begin()), not on the bare pool like the
  // race test above. postgres.js/Bun.SQL poison the WHOLE begin() block
  // once any statement inside it errors, even if the JS layer already
  // caught and classified that error — so without the runInSavepoint fix
  // in event-store-executor-write.ts, the LOSER's transaction() call itself
  // rejects with the raw PostgresError instead of resolving to the
  // version_conflict writeFailure create() already produced.
  test("two concurrent first-time creates of the same id inside a transaction → one succeeds, one converges to version_conflict", async () => {
    const id = "11111111-1111-4111-8111-111111111111";

    const [a, b] = await Promise.all([
      transaction(testDb.db, (tx) =>
        crud.create({ id, email: "a@test.de" }, admin, createTenantDb(tx, admin.tenantId)),
      ),
      transaction(testDb.db, (tx) =>
        crud.create({ id, email: "b@test.de" }, admin, createTenantDb(tx, admin.tenantId)),
      ),
    ]);

    const results = [a, b];
    expect(results.filter((r) => r.isSuccess)).toHaveLength(1);
    expect(results.filter((r) => !r.isSuccess && r.error.code === "version_conflict")).toHaveLength(
      1,
    );

    const healthCheck = (await asRawClient(testDb.db).unsafe(`SELECT 1 AS ok`)) as Array<{
      ok: number;
    }>;
    expect(healthCheck[0]?.ok).toBe(1);
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
