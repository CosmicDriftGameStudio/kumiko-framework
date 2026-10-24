import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createTestEnvelopeCipher } from "@cosmicdrift/kumiko-testing/helpers";
import {
  createTestDb,
  type TestDb,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  InMemoryKmsAdapter,
  PII_CIPHERTEXT_PREFIX,
  PII_ERASED_SENTINEL,
} from "../../crypto/index.ts";
import { asRawClient } from "../../db/query.ts";
import { createBooleanField, createEntity, createTextField } from "../../engine/index.ts";
import type { EntityId } from "../../engine/types/index.ts";
import { FrameworkReasons } from "../../errors/index.ts";
import { append, loadEventsAfterVersion } from "../../event-store/index.ts";
import type { EntityCache } from "../../pipeline/entity-cache.ts";
import { TestUsers, testTenantId } from "../../seeding/seed-users.ts";
import { applyEntityEvent } from "../apply-entity-event.ts";
import { resetEntityFieldEncryptionCacheForTests } from "../entity-field-encryption.ts";
import { createEventStoreExecutor, WritePurposes } from "../event-store-executor.ts";
import { buildExecutorContext } from "../event-store-executor-context.ts";
import { buildEntityTable } from "../table-builder.ts";
import { createTenantDb, type TenantDb, withExecutorManagedWrites } from "../tenant-db.ts";

const entity = createEntity({
  table: "read_es_exec_users",
  fields: {
    email: createTextField({
      required: true,
      searchable: true,
      personal: false,
      reason: "test_fixture",
    }),
    firstName: createTextField({ personal: false, reason: "test_fixture" }),
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
  tdb = createTenantDb({ db: testDb.db, tenantId: adminUser.tenantId });
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

  test("list hides soft-deleted rows; includeDeleted returns them (trash query)", async () => {
    const created = await crud.create({ email: "trash@test.de" }, adminUser, tdb);
    if (!created.isSuccess) throw new Error("setup failed");
    await crud.delete({ id: created.data.id }, adminUser, tdb);

    const live = await crud.list({}, adminUser, tdb);
    expect(live.rows.find((r) => r["id"] === created.data.id)).toBeUndefined();

    const trash = await crud.list({}, adminUser, tdb, { includeDeleted: true });
    const row = trash.rows.find((r) => r["id"] === created.data.id);
    expect(row).toBeDefined();
    expect(row?.["isDeleted"]).toBe(true);
  });
});

// Sensitive fields: passwords/tokens/IBANs must be ciphertext-at-rest
// (boot validates sensitive ⇒ pii | encrypted). The event log carries the
// table ciphertext — replay reproduces the row byte-identically. Plaintext
// never lands in permanent history; the caller-facing event echo strips the
// field entirely.
const SENSITIVE_TEST_KEY = Buffer.from("s3nS!t1vE.kP9xQ2@wN!vL$hR5yT8eU0").toString("base64");
const sensitiveEntity = createEntity({
  table: "read_es_exec_sensitive",
  fields: {
    email: createTextField({ required: true, personal: false, reason: "test_fixture" }),
    passwordHash: createTextField({
      personal: false,
      reason: "test_fixture",
      sensitive: true,
      encrypted: true,
    }),
    apiToken: createTextField({
      personal: false,
      reason: "test_fixture",
      sensitive: true,
      encrypted: true,
    }),
  },
  softDelete: true,
});
const sensitiveTable = buildEntityTable("esExecSensitive", sensitiveEntity);

describe("event-store-executor — sensitive fields", () => {
  const crud = createEventStoreExecutor(sensitiveTable, sensitiveEntity, {
    entityName: "esExecSensitive",
    encryption: createTestEnvelopeCipher(SENSITIVE_TEST_KEY),
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
    const rows = (await asRawClient(testDb.db).unsafe(
      `SELECT type, payload FROM kumiko_events ORDER BY id DESC LIMIT 1`,
    )) as Array<{ type: string; payload: unknown }>;
    const row = rows[0];
    if (!row) throw new Error("no events in store");
    return {
      type: row["type"],
      payload: (typeof row["payload"] === "string"
        ? JSON.parse(row["payload"])
        : row["payload"]) as TPayload,
    };
  }

  test("create event payload carries sensitive fields as table ciphertext; echo strips them", async () => {
    const result = await crud.create(
      { email: "s@test.de", passwordHash: "pw-hash-123", apiToken: "tok-abc" },
      adminUser,
      tdb,
    );
    if (!result.isSuccess) throw new Error("create failed");
    // Caller-facing row: plaintext preserved.
    expect(result.data.data["passwordHash"]).toBe("pw-hash-123");
    expect(result.data.data["apiToken"]).toBe("tok-abc");

    // Event payload: ciphertext, byte-identical to the table column.
    const event = await lastEvent();
    expect(event.type).toBe("esExecSensitive.created");
    expect(event.payload["email"]).toBe("s@test.de");
    expect(event.payload["passwordHash"]).toBeDefined();
    expect(event.payload["passwordHash"]).not.toBe("pw-hash-123");
    const rawRows = (await asRawClient(testDb.db).unsafe(
      `SELECT password_hash FROM read_es_exec_sensitive WHERE email = 's@test.de' LIMIT 1`,
    )) as Array<{ password_hash: string }>;
    expect(event.payload["passwordHash"]).toBe(rawRows[0]!.password_hash);

    // Caller-facing event echo stays stripped.
    if (!result.data.event) throw new Error("no event echo");
    expect(result.data.event.payload["passwordHash"]).toBeUndefined();
    expect(result.data.event.payload["apiToken"]).toBeUndefined();
  });

  test("update event carries ciphertext in BOTH changes and previous", async () => {
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
    // Changes: email plaintext (public), passwordHash ciphertext.
    expect(event.payload.changes.email).toBe("u2@test.de");
    expect(event.payload.changes.passwordHash).toBeDefined();
    expect(event.payload.changes.passwordHash).not.toBe("new-hash");
    // Previous: email plaintext, passwordHash + apiToken ciphertext.
    expect(event.payload.previous.email).toBe("u@test.de");
    expect(event.payload.previous.passwordHash).toBeDefined();
    expect(event.payload.previous.passwordHash).not.toBe("old-hash");
    expect(event.payload.previous.apiToken).toBeDefined();
    expect(event.payload.previous.apiToken).not.toBe("old-tok");

    // Caller-facing event echo stays stripped.
    if (!result.data.event) throw new Error("no event echo");
    const echoPayload = result.data.event.payload as {
      changes: Record<string, unknown>;
      previous: Record<string, unknown>;
    };
    expect(echoPayload.changes["passwordHash"]).toBeUndefined();
    expect(echoPayload.previous["passwordHash"]).toBeUndefined();
    expect(echoPayload.previous["apiToken"]).toBeUndefined();
  });

  test("delete event carries ciphertext in previous", async () => {
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
    expect(event.payload.previous.passwordHash).toBeDefined();
    expect(event.payload.previous.passwordHash).not.toBe("pw");
    expect(event.payload.previous.apiToken).toBeDefined();
    expect(event.payload.previous.apiToken).not.toBe("tk");
  });

  test("restore event carries ciphertext in previous", async () => {
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
    expect(event.payload.previous.passwordHash).toBeDefined();
    expect(event.payload.previous.passwordHash).not.toBe("pw");
    expect(event.payload.previous.apiToken).toBeDefined();
    expect(event.payload.previous.apiToken).not.toBe("tk");
  });
});

describe("event-store-executor — detail liefert die Stream-Version", () => {
  const crud = createEventStoreExecutor(table, entity, { entityName: "esExecUser" });

  // Lifecycle writes via ctx.events.append advance the stream without changing row.version.
  // Returning the stale row version from detail would make every CRUD update built on
  // entityEdit (which uses detail.version for optimistic locking) fail with
  // version_conflict. For example, incident:open can advance the stream to v2 while
  // the row remains at v1, preventing incident-edit from saving.
  test("nach ctx.events.append-artigem Stream-Bump: detail.version == Stream, Update damit erfolgreich", async () => {
    const created = await crud.create({ email: "stream@test.de" }, adminUser, tdb);
    expect(created.isSuccess).toBe(true);
    if (!created.isSuccess) return;
    const id = created.data.id;

    // Hand-emitted event on the same aggregate, as in incident:post-update.
    await append(testDb.db, {
      aggregateId: String(id),
      aggregateType: "esExecUser",
      tenantId: adminUser.tenantId,
      expectedVersion: 1,
      type: "esExecUser.lifecycle-bumped",
      payload: { note: "stream moved past the row" },
      metadata: { userId: String(adminUser.id) },
    });

    const detail = await crud.detail({ id }, adminUser, tdb);
    expect(detail).not.toBeNull();
    expect(detail?.["version"]).toBe(2);

    const updated = await crud.update(
      { id, version: 2, changes: { firstName: "After" } },
      adminUser,
      tdb,
    );
    expect(updated.isSuccess).toBe(true);
  });

  // A's detail() reads row and stream version; B commits an update in between
  // the two reads of the old implementation. Handing out (old row, new
  // version) lets A's update pass the optimistic lock and overwrite B.
  test("concurrent update during detail(): A's update on detail.version conflicts, B's write survives", async () => {
    const created = await crud.create({ email: "race@test.de", firstName: "orig" }, adminUser, tdb);
    expect(created.isSuccess).toBe(true);
    if (!created.isSuccess) return;
    const id = created.data.id;

    let afterNextStatement: (() => Promise<void>) | undefined;
    const hookedDb = new Proxy(testDb.db, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target);
        if (typeof value !== "function") return value;
        if (prop !== "unsafe") return value.bind(target);
        return async (...args: unknown[]) => {
          const result = await value.apply(target, args);
          const hook = afterNextStatement;
          afterNextStatement = undefined;
          if (hook) await hook();
          return result;
        };
      },
    });
    const tdbA = createTenantDb({ db: hookedDb, tenantId: adminUser.tenantId });

    afterNextStatement = async () => {
      const b = await crud.update({ id, version: 1, changes: { firstName: "B" } }, adminUser, tdb);
      expect(b.isSuccess).toBe(true);
      if (b.isSuccess) expect(b.data.data["version"]).toBe(2);
    };
    const detailA = await crud.detail({ id }, adminUser, tdbA);
    expect(afterNextStatement).toBeUndefined();
    expect(detailA).not.toBeNull();

    const updateA = await crud.update(
      { id, version: Number(detailA?.["version"]), changes: { firstName: "A" } },
      adminUser,
      tdb,
    );
    expect(updateA.isSuccess).toBe(false);
    if (updateA.isSuccess) return;
    expect(updateA.error.code).toBe("version_conflict");

    const after = await crud.detail({ id }, adminUser, tdb);
    expect(after?.["firstName"]).toBe("B");
  });

  test("list after a stream bump returns the stream version", async () => {
    const created = await crud.create({ email: "list-stream@test.de" }, adminUser, tdb);
    expect(created.isSuccess).toBe(true);
    if (!created.isSuccess) return;
    const id = created.data.id;
    await append(testDb.db, {
      aggregateId: String(id),
      aggregateType: "esExecUser",
      tenantId: adminUser.tenantId,
      expectedVersion: 1,
      type: "esExecUser.lifecycle-bumped",
      payload: { note: "stream moved past the row" },
      metadata: { userId: String(adminUser.id) },
    });

    const listed = await crud.list({ limit: 10 }, adminUser, tdb);

    expect(listed.rows.map((r) => [r["id"], r["version"]])).toEqual([[id, 2]]);
  });

  test("concurrent update during list(): row and version come from the same snapshot", async () => {
    const created = await crud.create(
      { email: "list-race@test.de", firstName: "orig" },
      adminUser,
      tdb,
    );
    expect(created.isSuccess).toBe(true);
    if (!created.isSuccess) return;
    const id = created.data.id;

    let afterNextStatement: (() => Promise<void>) | undefined;
    const hookedDb = new Proxy(testDb.db, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target);
        if (typeof value !== "function") return value;
        if (prop !== "unsafe") return value.bind(target);
        return async (...args: unknown[]) => {
          const result = await value.apply(target, args);
          const hook = afterNextStatement;
          afterNextStatement = undefined;
          if (hook) await hook();
          return result;
        };
      },
    });
    const tdbA = createTenantDb({ db: hookedDb, tenantId: adminUser.tenantId });

    afterNextStatement = async () => {
      const b = await crud.update({ id, version: 1, changes: { firstName: "B" } }, adminUser, tdb);
      expect(b.isSuccess).toBe(true);
    };
    const listed = await crud.list({ limit: 10 }, adminUser, tdbA);

    expect(afterNextStatement).toBeUndefined();
    expect(listed.rows.map((r) => [r["firstName"], r["version"]])).toEqual([["orig", 1]]);
  });
});

const ENCRYPTION_TEST_KEY = Buffer.from("a]bJm#kP9xQ2@wN!vL$hR5yT8eU0iO3f").toString("base64");
const encryptedEntity = createEntity({
  table: "read_es_exec_encrypted",
  fields: {
    email: createTextField({ required: true, personal: false, reason: "test_fixture" }),
    secretNote: createTextField({ personal: false, reason: "test_fixture", encrypted: true }),
  },
});
const encryptedTable = buildEntityTable("esExecEncrypted", encryptedEntity);

const encryptedSoftDeleteEntity = createEntity({
  table: "read_es_exec_enc_soft",
  fields: {
    email: createTextField({ required: true, personal: false, reason: "test_fixture" }),
    secretNote: createTextField({ personal: false, reason: "test_fixture", encrypted: true }),
  },
  softDelete: true,
});
const encryptedSoftDeleteTable = buildEntityTable("esExecEncSoft", encryptedSoftDeleteEntity);

describe("event-store-executor — encrypted fields", () => {
  const encryption = createTestEnvelopeCipher(ENCRYPTION_TEST_KEY);
  const crud = createEventStoreExecutor(encryptedTable, encryptedEntity, {
    entityName: "esExecEncrypted",
    encryption,
  });

  const softDeleteCrud = createEventStoreExecutor(
    encryptedSoftDeleteTable,
    encryptedSoftDeleteEntity,
    { entityName: "esExecEncSoft", encryption },
  );

  beforeAll(async () => {
    resetEntityFieldEncryptionCacheForTests();
    await unsafeCreateEntityTable(testDb.db, encryptedEntity, "esExecEncrypted");
    await unsafeCreateEntityTable(testDb.db, encryptedSoftDeleteEntity, "esExecEncSoft");
  });

  beforeEach(async () => {
    await asRawClient(testDb.db).unsafe(
      `TRUNCATE kumiko_events, read_es_exec_encrypted, read_es_exec_enc_soft RESTART IDENTITY CASCADE`,
    );
  });

  test("stores ciphertext in DB and returns plaintext on read", async () => {
    const plaintext = "super-secret-note";
    const result = await crud.create(
      { email: "enc@test.de", secretNote: plaintext },
      adminUser,
      tdb,
    );
    if (!result.isSuccess) throw new Error("create failed");
    expect(result.data.data["secretNote"]).toBe(plaintext);

    const rawRows = (await asRawClient(testDb.db).unsafe(
      `SELECT secret_note FROM read_es_exec_encrypted WHERE email = 'enc@test.de' LIMIT 1`,
    )) as Array<{ secret_note: string }>;
    expect(rawRows[0]?.secret_note).toBeDefined();
    expect(rawRows[0]!.secret_note).not.toBe(plaintext);

    const detail = await crud.detail({ id: result.data.id }, adminUser, tdb);
    expect(detail?.["secretNote"]).toBe(plaintext);
  });

  test("update encrypts changed encrypted field", async () => {
    const created = await crud.create(
      { email: "upd-enc@test.de", secretNote: "old-note" },
      adminUser,
      tdb,
    );
    if (!created.isSuccess) throw new Error("create failed");

    const updated = await crud.update(
      {
        id: created.data.id,
        version: 1,
        changes: { secretNote: "new-note" },
      },
      adminUser,
      tdb,
    );
    if (!updated.isSuccess) throw new Error("update failed");
    expect(updated.data.data["secretNote"]).toBe("new-note");
  });

  test("update WITHOUT skipUnchanged still re-encrypts a resubmitted-but-unchanged encrypted field (KEK-rotation/backfill contract)", async () => {
    // Regression guard: direct executor.update() callers that don't opt into
    // skipUnchanged rely on today's always-re-encrypt behavior to force a
    // fresh ciphertext for an unchanged plaintext — e.g. auth-mfa's
    // KEK-rotation job (reencrypt.job.ts) and the user-data-rights
    // backfill both resubmit the CURRENT value on purpose to land a real
    // event. A blanket value-diff here would silently break both.
    const created = await crud.create(
      { email: "force-enc@test.de", secretNote: "same-note" },
      adminUser,
      tdb,
    );
    if (!created.isSuccess) throw new Error("create failed");

    const before = (await asRawClient(testDb.db).unsafe(
      `SELECT secret_note FROM read_es_exec_encrypted WHERE email = 'force-enc@test.de' LIMIT 1`,
    )) as Array<{ secret_note: string }>;

    const updated = await crud.update(
      { id: created.data.id, version: 1, changes: { secretNote: "same-note" } },
      adminUser,
      tdb,
    );
    if (!updated.isSuccess) throw new Error("update failed");

    const after = (await asRawClient(testDb.db).unsafe(
      `SELECT secret_note FROM read_es_exec_encrypted WHERE email = 'force-enc@test.de' LIMIT 1`,
    )) as Array<{ secret_note: string }>;

    // Fresh AEAD nonce per encrypt call → different ciphertext even though
    // the plaintext is identical. Byte-identical would mean the write was
    // skipped, which is exactly what would break KEK rotation.
    expect(after[0]?.secret_note).toBeDefined();
    expect(after[0]?.secret_note).not.toBe(before[0]?.secret_note);
  });

  test("update with skipUnchanged: true omits a resubmitted-but-unchanged encrypted field — no phantom re-encrypt (#464)", async () => {
    const created = await crud.create(
      { email: "noop-enc@test.de", secretNote: "same-note" },
      adminUser,
      tdb,
    );
    if (!created.isSuccess) throw new Error("create failed");

    const before = (await asRawClient(testDb.db).unsafe(
      `SELECT secret_note FROM read_es_exec_encrypted WHERE email = 'noop-enc@test.de' LIMIT 1`,
    )) as Array<{ secret_note: string }>;

    const updated = await crud.update(
      {
        id: created.data.id,
        version: 1,
        changes: { secretNote: "same-note", email: "noop-enc-2@test.de" },
      },
      adminUser,
      tdb,
      { skipUnchanged: true },
    );
    if (!updated.isSuccess) throw new Error("update failed");

    const after = (await asRawClient(testDb.db).unsafe(
      `SELECT secret_note FROM read_es_exec_encrypted WHERE email = 'noop-enc-2@test.de' LIMIT 1`,
    )) as Array<{ secret_note: string }>;

    // Re-encrypting the same plaintext produces a fresh AEAD nonce → a
    // different ciphertext even for an unchanged value. Byte-identical
    // ciphertext proves the column was never touched by this update.
    expect(after[0]?.secret_note).toBe(before[0]?.secret_note);

    const rows = (await asRawClient(testDb.db).unsafe(
      `SELECT payload FROM kumiko_events WHERE type = 'esExecEncrypted.updated' ORDER BY id DESC LIMIT 1`,
    )) as Array<{ payload: { changes?: Record<string, unknown> } }>;
    expect(rows[0]?.payload.changes).not.toHaveProperty("secretNote");
  });

  test("update's persisted event carries ciphertext (not plaintext) for an encrypted field in `previous`", async () => {
    // Regression: `previous` in the STORED event came from loadById(), which
    // decrypts — appending it unchanged would put the plaintext of an
    // `encrypted` field into the immutable kumiko_events log even though the
    // row itself is stored as ciphertext.
    const created = await crud.create(
      { email: "prev-enc@test.de", secretNote: "old-plaintext-note" },
      adminUser,
      tdb,
    );
    if (!created.isSuccess) throw new Error("create failed");

    // Change an UNRELATED field — `secretNote` still rides along in `previous`
    // unchanged, at its pre-update (decrypted) value.
    const updated = await crud.update(
      { id: created.data.id, version: 1, changes: { email: "prev-enc-2@test.de" } },
      adminUser,
      tdb,
    );
    if (!updated.isSuccess) throw new Error("update failed");

    const rows = (await asRawClient(testDb.db).unsafe(
      `SELECT payload FROM kumiko_events WHERE type = 'esExecEncrypted.updated' ORDER BY id DESC LIMIT 1`,
    )) as Array<{ payload: { previous?: { secretNote?: string } } }>;
    const storedPrevious = rows[0]?.payload.previous?.secretNote;
    expect(storedPrevious).toBeDefined();
    expect(storedPrevious).not.toBe("old-plaintext-note");
  });

  test("delete's persisted event carries ciphertext (not plaintext) for an encrypted field in `previous`", async () => {
    const created = await crud.create(
      { email: "del-enc@test.de", secretNote: "delete-plaintext-note" },
      adminUser,
      tdb,
    );
    if (!created.isSuccess) throw new Error("create failed");

    const deleted = await crud.delete({ id: created.data.id }, adminUser, tdb);
    if (!deleted.isSuccess) throw new Error("delete failed");

    const rows = (await asRawClient(testDb.db).unsafe(
      `SELECT payload FROM kumiko_events WHERE type = 'esExecEncrypted.deleted' ORDER BY id DESC LIMIT 1`,
    )) as Array<{ payload: { previous?: { secretNote?: string } } }>;
    const storedPrevious = rows[0]?.payload.previous?.secretNote;
    expect(storedPrevious).toBeDefined();
    expect(storedPrevious).not.toBe("delete-plaintext-note");
  });

  test("restore returns plaintext (data + previous) for an encrypted field, not ciphertext (725/2)", async () => {
    // Regression: restore() read `restored`/`data` straight from
    // applyEntityEvent/selectMany (both ciphertext for an `encrypted` field)
    // and returned them without decryptForRead — unlike create/update/list/
    // detail, which all decrypt before handing the row to the caller.
    const created = await softDeleteCrud.create(
      { email: "restore-enc@test.de", secretNote: "restore-plaintext-note" },
      adminUser,
      tdb,
    );
    if (!created.isSuccess) throw new Error("create failed");

    const deleted = await softDeleteCrud.delete({ id: created.data.id }, adminUser, tdb);
    if (!deleted.isSuccess) throw new Error("delete failed");

    const restored = await softDeleteCrud.restore({ id: created.data.id }, adminUser, tdb);
    if (!restored.isSuccess) throw new Error("restore failed");

    expect(restored.data.data["secretNote"]).toBe("restore-plaintext-note");
    expect(restored.data.previous?.["secretNote"]).toBe("restore-plaintext-note");
  });
});

describe("event-store-executor — undecryptable encrypted field with entity cache", () => {
  const encryption = createTestEnvelopeCipher(ENCRYPTION_TEST_KEY);
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
  const cachedCrud = createEventStoreExecutor(encryptedTable, encryptedEntity, {
    entityName: "esExecEncrypted",
    encryption,
    entityCache,
  });

  beforeAll(async () => {
    resetEntityFieldEncryptionCacheForTests();
    await unsafeCreateEntityTable(testDb.db, encryptedEntity, "esExecEncrypted");
  });

  beforeEach(async () => {
    store.clear();
    await asRawClient(testDb.db).unsafe(
      `TRUNCATE kumiko_events, read_es_exec_encrypted RESTART IDENTITY CASCADE`,
    );
  });

  test("a degraded row is never cached; after repair detail serves the real value", async () => {
    const created = await cachedCrud.create(
      { email: "degraded@test.de", secretNote: "real-note" },
      adminUser,
      tdb,
    );
    if (!created.isSuccess) throw new Error("create failed");
    const id = created.data.id;
    const storeKey = `${adminUser.tenantId}:esExecEncrypted:${id}`;
    const goodStored = (await asRawClient(testDb.db).unsafe(
      `SELECT secret_note FROM read_es_exec_encrypted WHERE id = $1`,
      [id],
    )) as Array<{ secret_note: string }>;
    const goodEnvelope = goodStored[0]?.secret_note;
    await asRawClient(testDb.db).unsafe(
      `UPDATE read_es_exec_encrypted SET secret_note = 'not-an-envelope' WHERE id = $1`,
      [id],
    );

    const first = await cachedCrud.detail({ id }, adminUser, tdb);
    const cachedAfterFirst = store.has(storeKey);
    const second = await cachedCrud.detail({ id }, adminUser, tdb);
    const cachedAfterSecond = store.has(storeKey);
    await asRawClient(testDb.db).unsafe(
      `UPDATE read_es_exec_encrypted SET secret_note = $2 WHERE id = $1`,
      [id, goodEnvelope],
    );
    const repaired = await cachedCrud.detail({ id }, adminUser, tdb);

    expect([first?.["secretNote"], second?.["secretNote"]]).toEqual([null, null]);
    expect([cachedAfterFirst, cachedAfterSecond]).toEqual([false, false]);
    expect(repaired?.["secretNote"]).toBe("real-note");
    expect(store.has(storeKey)).toBe(true);
  });
});

describe("event-store-executor — entity cache read-through", () => {
  // In-memory stand-in for EntityCache — no Redis needed.
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
  const cachedCrud = createEventStoreExecutor(table, entity, {
    entityName: "esExecUser",
    entityCache,
  });

  beforeEach(() => store.clear());

  test("first detail populates cache; second detail is served from cache", async () => {
    const created = await cachedCrud.create({ email: "cache@test.de" }, adminUser, tdb);
    if (!created.isSuccess) throw new Error("create failed");
    const id = created.data.id;
    const storeKey = `${adminUser.tenantId}:esExecUser:${id}`;

    // create() calls del() — cache must be empty after create.
    expect(store.has(storeKey)).toBe(false);

    // First detail: miss → DB → populates cache.
    const first = await cachedCrud.detail({ id }, adminUser, tdb);
    expect(first).not.toBeNull();
    expect(store.has(storeKey)).toBe(true);

    // Poison the cache entry — proves the second detail reads from cache, not DB.
    const cachedEntry = store.get(storeKey);
    if (!cachedEntry) throw new Error("cache not populated");
    store.set(storeKey, { ...cachedEntry, email: "from-cache@test.de" });

    const second = await cachedCrud.detail({ id }, adminUser, tdb);
    expect(second?.["email"]).toBe("from-cache@test.de");
  });

  test("stale cache entry re-set after a concurrent update is ignored: detail returns the live row, old-version update conflicts", async () => {
    const created = await cachedCrud.create(
      { email: "stale@test.de", firstName: "orig" },
      adminUser,
      tdb,
    );
    if (!created.isSuccess) throw new Error("create failed");
    const id = created.data.id;
    const storeKey = `${adminUser.tenantId}:esExecUser:${id}`;

    await cachedCrud.detail({ id }, adminUser, tdb);
    const staleEntry = store.get(storeKey);
    if (!staleEntry) throw new Error("cache not populated");

    const b = await cachedCrud.update(
      { id, version: 1, changes: { firstName: "B" } },
      adminUser,
      tdb,
    );
    expect(b.isSuccess).toBe(true);
    expect(store.has(storeKey)).toBe(false);
    // A detail() that read before B's commit lands its set() after B's del().
    store.set(storeKey, staleEntry);

    const detail = await cachedCrud.detail({ id }, adminUser, tdb);
    expect(detail?.["firstName"]).toBe("B");
    expect(detail?.["version"]).toBe(2);

    const updateA = await cachedCrud.update(
      { id, version: 1, changes: { firstName: "A" } },
      adminUser,
      tdb,
    );
    expect(updateA.isSuccess).toBe(false);
    if (!updateA.isSuccess) expect(updateA.error.code).toBe("version_conflict");
  });

  test("cache entry cached before a stream bump is a miss; detail returns version 2", async () => {
    const created = await cachedCrud.create({ email: "bump@test.de" }, adminUser, tdb);
    if (!created.isSuccess) throw new Error("create failed");
    const id = created.data.id;
    const storeKey = `${adminUser.tenantId}:esExecUser:${id}`;

    await cachedCrud.detail({ id }, adminUser, tdb);
    const cachedEntry = store.get(storeKey);
    if (!cachedEntry) throw new Error("cache not populated");
    store.set(storeKey, { ...cachedEntry, email: "from-cache@test.de" });

    await append(testDb.db, {
      aggregateId: String(id),
      aggregateType: "esExecUser",
      tenantId: adminUser.tenantId,
      expectedVersion: 1,
      type: "esExecUser.lifecycle-bumped",
      payload: { note: "stream moved past the cached row" },
      metadata: { userId: String(adminUser.id) },
    });

    const detail = await cachedCrud.detail({ id }, adminUser, tdb);
    expect(detail?.["version"]).toBe(2);
    expect(detail?.["email"]).toBe("bump@test.de");
    expect(store.get(storeKey)?.["version"]).toBe(2);
  });
});

describe("event-store-executor — entity cache + encrypted fields", () => {
  // Regression: detail() cached the already-decrypted row verbatim, so an
  // `encrypted` field's plaintext ended up in a second at-rest store (Redis)
  // the field-encryption feature doesn't cover.
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
  const encryption = createTestEnvelopeCipher(ENCRYPTION_TEST_KEY);
  const cachedEncryptedCrud = createEventStoreExecutor(encryptedTable, encryptedEntity, {
    entityName: "esExecEncrypted",
    entityCache,
    encryption,
  });

  beforeEach(() => store.clear());

  test("cached row is ciphertext at rest; detail() still returns plaintext to the caller", async () => {
    const created = await cachedEncryptedCrud.create(
      { email: "cache-enc@test.de", secretNote: "cache-plaintext-note" },
      adminUser,
      tdb,
    );
    if (!created.isSuccess) throw new Error("create failed");
    const id = created.data.id;
    const storeKey = `${adminUser.tenantId}:esExecEncrypted:${id}`;

    const first = await cachedEncryptedCrud.detail({ id }, adminUser, tdb);
    expect(first?.["secretNote"]).toBe("cache-plaintext-note");

    const cachedRaw = store.get(storeKey);
    expect(cachedRaw?.["secretNote"]).toBeDefined();
    expect(cachedRaw?.["secretNote"]).not.toBe("cache-plaintext-note");

    // Second read (cache hit) must still decrypt back to the real plaintext.
    const second = await cachedEncryptedCrud.detail({ id }, adminUser, tdb);
    expect(second?.["secretNote"]).toBe("cache-plaintext-note");
  });

  // Regression twin pack for the list() path:
  //   1. list decrypted BEFORE the snake→camel coercion, so any multi-word
  //      encrypted/pii field (secret_note vs secretNote) came back as raw
  //      ciphertext to the caller.
  //   2. list's mset cached the decrypted rows — plaintext in Redis, the
  //      exact leak the detail() path re-encrypts to avoid.
  test("list() returns plaintext for camelCase encrypted fields and caches ciphertext", async () => {
    const created = await cachedEncryptedCrud.create(
      { email: "cache-list@test.de", secretNote: "list-plaintext-note" },
      adminUser,
      tdb,
    );
    if (!created.isSuccess) throw new Error("create failed");
    const storeKey = `${adminUser.tenantId}:esExecEncrypted:${created.data.id}`;
    store.clear();

    const list = await cachedEncryptedCrud.list({}, adminUser, tdb);
    const listed = list.rows.find((r) => r["id"] === created.data.id);
    expect(listed?.["secretNote"]).toBe("list-plaintext-note");

    const cachedRaw = store.get(storeKey);
    expect(cachedRaw?.["secretNote"]).toBeDefined();
    expect(cachedRaw?.["secretNote"]).not.toBe("list-plaintext-note");
  });
});

// PII subject encryption (crypto-shredding): pii/userOwned/
// tenantOwned fields are encrypted with the erase subject's DEK. Event
// payload AND projection row carry ciphertext (live == rebuild); erasing the
// subject key renders every value as the [[erased]] sentinel without
// touching the immutable log.
const piiEntity = createEntity({
  table: "read_es_exec_pii",
  fields: {
    email: createTextField({ required: true, personal: "self", find: "none" }),
    note: createTextField({
      personal: { of: "authorId", whenAbsent: "tenant" },
      find: "none",
    }),
    authorId: createTextField({ personal: false, reason: "test_fixture" }),
    plain: createTextField({ personal: false, reason: "test_fixture" }),
  },
});
const piiTable = buildEntityTable("esExecPii", piiEntity);

describe("event-store-executor — pii subject encryption", () => {
  const kms = new InMemoryKmsAdapter();
  const crud = createEventStoreExecutor(piiTable, piiEntity, {
    entityName: "esExecPii",
    kms,
  });

  beforeAll(async () => {
    await unsafeCreateEntityTable(testDb.db, piiEntity, "esExecPii");
  });

  beforeEach(async () => {
    await asRawClient(testDb.db).unsafe(
      `TRUNCATE kumiko_events, read_es_exec_pii RESTART IDENTITY CASCADE`,
    );
  });

  test("create: projection row + event payload are ciphertext, API reads plaintext", async () => {
    const result = await crud.create({ email: "pii@test.de", plain: "visible" }, adminUser, tdb);
    if (!result.isSuccess) throw new Error("create failed");
    expect(result.data.data["email"]).toBe("pii@test.de");

    const rawRows = (await asRawClient(testDb.db).unsafe(
      `SELECT email, plain FROM read_es_exec_pii LIMIT 1`,
    )) as Array<{ email: string; plain: string }>;
    expect(rawRows[0]!.email).toStartWith(`${PII_CIPHERTEXT_PREFIX}user:${result.data.id}:`);
    expect(rawRows[0]!.plain).toBe("visible");

    const events = (await asRawClient(testDb.db).unsafe(
      `SELECT payload FROM kumiko_events WHERE type = 'esExecPii.created' LIMIT 1`,
    )) as Array<{ payload: { email?: string } }>;
    expect(events[0]?.payload.email).toStartWith(PII_CIPHERTEXT_PREFIX);

    const detail = await crud.detail({ id: result.data.id }, adminUser, tdb);
    expect(detail?.["email"]).toBe("pii@test.de");
    const list = await crud.list({}, adminUser, tdb);
    expect(list.rows[0]?.["email"]).toBe("pii@test.de");
  });

  test("userOwned update without ownerField in changes resolves via the merged row", async () => {
    const created = await crud.create(
      { email: "owner@test.de", note: "v1", authorId: TestUsers.admin.id },
      adminUser,
      tdb,
    );
    if (!created.isSuccess) throw new Error("create failed");

    const updated = await crud.update(
      { id: created.data.id, version: 1, changes: { note: "v2" } },
      adminUser,
      tdb,
    );
    if (!updated.isSuccess) throw new Error("update failed");
    expect(updated.data.data["note"]).toBe("v2");

    const rawRows = (await asRawClient(testDb.db).unsafe(
      `SELECT note FROM read_es_exec_pii LIMIT 1`,
    )) as Array<{ note: string }>;
    expect(rawRows[0]!.note).toStartWith(`${PII_CIPHERTEXT_PREFIX}user:${TestUsers.admin.id}:`);
  });

  test("eraseKey: detail renders the sentinel, stored events stay byte-identical", async () => {
    const created = await crud.create({ email: "forget@test.de" }, adminUser, tdb);
    if (!created.isSuccess) throw new Error("create failed");

    const eventsBefore = (await asRawClient(testDb.db).unsafe(
      `SELECT payload FROM kumiko_events WHERE type = 'esExecPii.created' LIMIT 1`,
    )) as Array<{ payload: { email?: string } }>;

    await kms.eraseKey({ kind: "user", userId: String(created.data.id) });

    const detail = await crud.detail({ id: created.data.id }, adminUser, tdb);
    expect(detail?.["email"]).toBe(PII_ERASED_SENTINEL);

    const eventsAfter = (await asRawClient(testDb.db).unsafe(
      `SELECT payload FROM kumiko_events WHERE type = 'esExecPii.created' LIMIT 1`,
    )) as Array<{ payload: { email?: string } }>;
    expect(eventsAfter[0]?.payload.email).toBe(eventsBefore[0]!.payload.email!);
  });

  test("rebuild after erase resurrects no plaintext (replay writes ciphertext, reads render sentinel)", async () => {
    const created = await crud.create({ email: "rebuild@test.de" }, adminUser, tdb);
    if (!created.isSuccess) throw new Error("create failed");
    await kms.eraseKey({ kind: "user", userId: String(created.data.id) });

    // Same code path rebuildProjection replays: applyEntityEvent on the
    // PERSISTED event (ciphertext payload). The response echo carries the
    // plaintext payload and must not be used as a replay source.
    const responseEvent = created.data.event as { payload: Record<string, unknown> } | undefined;
    expect(responseEvent?.payload["email"]).toBe("rebuild@test.de");
    await asRawClient(testDb.db).unsafe(`TRUNCATE read_es_exec_pii RESTART IDENTITY CASCADE`);
    const [storedEvent] = await loadEventsAfterVersion(
      testDb.db,
      String(created.data.id),
      adminUser.tenantId,
      0,
    );
    if (!storedEvent) throw new Error("no persisted event for the aggregate");
    const applied = await applyEntityEvent(
      storedEvent,
      piiTable,
      piiEntity,
      withExecutorManagedWrites(testDb.db),
    );
    expect(applied.kind).toBe("applied");

    const rawRows = (await asRawClient(testDb.db).unsafe(
      `SELECT email FROM read_es_exec_pii LIMIT 1`,
    )) as Array<{ email: string }>;
    expect(rawRows[0]!.email).toStartWith(PII_CIPHERTEXT_PREFIX);
    expect(rawRows[0]!.email).not.toContain("rebuild@test.de");

    const detail = await crud.detail({ id: created.data.id }, adminUser, tdb);
    expect(detail?.["email"]).toBe(PII_ERASED_SENTINEL);
  });

  test("without a kms adapter the engine is off: plaintext row (pre-#724 behavior)", async () => {
    const plainCrud = createEventStoreExecutor(piiTable, piiEntity, {
      entityName: "esExecPii",
    });
    const created = await plainCrud.create({ email: "off@test.de" }, adminUser, tdb);
    if (!created.isSuccess) throw new Error("create failed");

    const rawRows = (await asRawClient(testDb.db).unsafe(
      `SELECT email FROM read_es_exec_pii LIMIT 1`,
    )) as Array<{ email: string }>;
    expect(rawRows[0]!.email).toBe("off@test.de");
  });
});

const piiSoftEntity = createEntity({
  table: "read_es_exec_pii_soft",
  fields: {
    email: createTextField({ required: true, personal: "self", find: "none" }),
    secretNote: createTextField({ personal: false, reason: "test_fixture", encrypted: true }),
    ownerId: createTextField({ personal: false, reason: "test_fixture" }),
    ownerSecret: createTextField({ encrypted: true, personal: { of: "ownerId" }, find: "none" }),
  },
  softDelete: true,
});
const piiSoftTable = buildEntityTable("esExecPiiSoft", piiSoftEntity);

type KeyState = "existing-key" | "never-keyed";
const KEY_STATES: KeyState[] = ["existing-key", "never-keyed"];

describe("event-store-executor — restore re-encrypts pii in previous", () => {
  const encryption = createTestEnvelopeCipher(ENCRYPTION_TEST_KEY);
  const kms = new InMemoryKmsAdapter();
  const plainCrud = createEventStoreExecutor(piiSoftTable, piiSoftEntity, {
    entityName: "esExecPiiSoft",
    encryption,
  });
  const kmsCrud = createEventStoreExecutor(piiSoftTable, piiSoftEntity, {
    entityName: "esExecPiiSoft",
    encryption,
    kms,
  });
  const readContext = buildExecutorContext(piiSoftTable, piiSoftEntity, {
    entityName: "esExecPiiSoft",
    encryption,
    kms,
  });

  beforeAll(async () => {
    resetEntityFieldEncryptionCacheForTests();
    await unsafeCreateEntityTable(testDb.db, piiSoftEntity, "esExecPiiSoft");
  });

  beforeEach(async () => {
    await asRawClient(testDb.db).unsafe(
      `TRUNCATE kumiko_events, read_es_exec_pii_soft RESTART IDENTITY CASCADE`,
    );
  });

  async function loadStoredRestoredPrevious(): Promise<Record<string, unknown>> {
    const rows = (await asRawClient(testDb.db).unsafe(
      `SELECT payload FROM kumiko_events WHERE type = 'esExecPiiSoft.restored' ORDER BY id DESC LIMIT 1`,
    )) as Array<{ payload: { previous: Record<string, unknown> } }>;
    const payload = rows[0]?.payload;
    if (!payload) throw new Error("no restored event stored");
    const serialized = JSON.stringify(payload);
    for (const leaked of ["prekms@test.de", "prekms-note", "prekms-owner-secret"]) {
      expect(serialized).not.toContain(leaked);
    }
    for (const leaked of ["kms@test.de", "kms-note", "kms-owner-secret"]) {
      expect(serialized).not.toContain(leaked);
    }
    return payload.previous;
  }

  test("pre-KMS row: restored event previous carries ciphertext", async () => {
    const created = await plainCrud.create(
      {
        email: "prekms@test.de",
        secretNote: "prekms-note",
        ownerId: adminUser.id,
        ownerSecret: "prekms-owner-secret",
      },
      adminUser,
      tdb,
    );
    if (!created.isSuccess) throw new Error("create failed");
    const deleted = await plainCrud.delete({ id: created.data.id }, adminUser, tdb);
    if (!deleted.isSuccess) throw new Error("delete failed");

    const restored = await kmsCrud.restore({ id: created.data.id }, adminUser, tdb);
    if (!restored.isSuccess) throw new Error("restore failed");
    expect(restored.data.data["email"]).toBe("prekms@test.de");
    expect(restored.data.previous?.["email"]).toBe("prekms@test.de");
    expect(restored.data.previous?.["secretNote"]).toBe("prekms-note");

    const storedPrevious = await loadStoredRestoredPrevious();
    expect(String(storedPrevious["email"])).toStartWith(PII_CIPHERTEXT_PREFIX);
    expect(String(storedPrevious["ownerSecret"])).toStartWith(PII_CIPHERTEXT_PREFIX);

    const decrypted = await readContext.decryptForRead(storedPrevious);
    expect(decrypted["email"]).toBe("prekms@test.de");
    expect(decrypted["secretNote"]).toBe("prekms-note");
    expect(decrypted["ownerSecret"]).toBe("prekms-owner-secret");
  });

  test("KMS row: restored previous decrypts back without double-wrapping", async () => {
    const created = await kmsCrud.create(
      {
        email: "kms@test.de",
        secretNote: "kms-note",
        ownerId: adminUser.id,
        ownerSecret: "kms-owner-secret",
      },
      adminUser,
      tdb,
    );
    if (!created.isSuccess) throw new Error("create failed");
    const deleted = await kmsCrud.delete({ id: created.data.id }, adminUser, tdb);
    if (!deleted.isSuccess) throw new Error("delete failed");
    const restored = await kmsCrud.restore({ id: created.data.id }, adminUser, tdb);
    if (!restored.isSuccess) throw new Error("restore failed");

    const storedPrevious = await loadStoredRestoredPrevious();
    expect(String(storedPrevious["email"])).toStartWith(PII_CIPHERTEXT_PREFIX);

    const decrypted = await readContext.decryptForRead(storedPrevious);
    expect(decrypted["email"]).toBe("kms@test.de");
    expect(decrypted["secretNote"]).toBe("kms-note");
    expect(decrypted["ownerSecret"]).toBe("kms-owner-secret");
  });

  async function expectRestoreRefusedAndNothingStored(id: EntityId): Promise<void> {
    const result = await kmsCrud.restore({ id }, adminUser, tdb);

    expect(result.isSuccess).toBe(false);
    if (result.isSuccess) return;
    expect(result.error.details).toMatchObject({ reason: FrameworkReasons.subjectErased });
    const rows = (await asRawClient(testDb.db).unsafe(
      `SELECT is_deleted FROM read_es_exec_pii_soft WHERE id = '${id}'`,
    )) as Array<{ is_deleted: boolean }>;
    expect(rows[0]?.is_deleted).toBe(true);
    const restoredEvents = (await asRawClient(testDb.db).unsafe(
      `SELECT id FROM kumiko_events WHERE type = 'esExecPiiSoft.restored' AND aggregate_id = '${id}'`,
    )) as Array<{ id: unknown }>;
    expect(restoredEvents).toHaveLength(0);
  }

  test.each(KEY_STATES)(
    "erased subject key (%s): restore of a pre-KMS plaintext row fails with subject-erased and stores nothing",
    async (keyState) => {
      const created = await plainCrud.create(
        { email: "prekms@test.de", ownerId: adminUser.id },
        adminUser,
        tdb,
      );
      if (!created.isSuccess) throw new Error("create failed");
      const deleted = await plainCrud.delete({ id: created.data.id }, adminUser, tdb);
      if (!deleted.isSuccess) throw new Error("delete failed");
      await eraseSubjectKey(created.data.id, keyState);

      await expectRestoreRefusedAndNothingStored(created.data.id);
    },
  );

  test("erased subject: restore of a KMS row succeeds and stores the sentinel in previous", async () => {
    const created = await kmsCrud.create(
      { email: "kms@test.de", ownerId: adminUser.id },
      adminUser,
      tdb,
    );
    if (!created.isSuccess) throw new Error("create failed");
    const deleted = await kmsCrud.delete({ id: created.data.id }, adminUser, tdb);
    if (!deleted.isSuccess) throw new Error("delete failed");
    await kms.eraseKey({ kind: "user", userId: String(created.data.id) });

    const restored = await kmsCrud.restore({ id: created.data.id }, adminUser, tdb);

    expect(restored.isSuccess).toBe(true);
    const storedPrevious = await loadStoredRestoredPrevious();
    expect(storedPrevious["email"]).toBe(PII_ERASED_SENTINEL);
  });

  async function eraseSubjectKey(id: EntityId, keyState: KeyState): Promise<void> {
    const subject = { kind: "user", userId: String(id) } as const;
    if (keyState === "existing-key") await kms.createKey(subject);
    await kms.eraseKey(subject);
  }

  async function createPreKmsRowWithErasedSubject(keyState: KeyState): Promise<EntityId> {
    const created = await plainCrud.create(
      { email: "prekms@test.de", ownerId: adminUser.id },
      adminUser,
      tdb,
    );
    if (!created.isSuccess) throw new Error("create failed");
    await eraseSubjectKey(created.data.id, keyState);
    return created.data.id;
  }

  async function loadStoredPrevious(type: string, id: EntityId): Promise<Record<string, unknown>> {
    const rows = (await asRawClient(testDb.db).unsafe(
      `SELECT payload FROM kumiko_events WHERE type = '${type}' AND aggregate_id = '${id}' ORDER BY id DESC LIMIT 1`,
    )) as Array<{ payload: { previous: Record<string, unknown> } }>;
    const payload = rows[0]?.payload;
    if (!payload) throw new Error(`no ${type} event stored`);
    expect(JSON.stringify(payload)).not.toContain("prekms@test.de");
    return payload.previous;
  }

  test.each(KEY_STATES)(
    "erased subject (%s): update fails without a writePurpose, erasure update stores the sentinel in previous",
    async (keyState) => {
      const id = await createPreKmsRowWithErasedSubject(keyState);
      const changes = { secretNote: "after-erasure" };

      await expect(
        kmsCrud.update({ id, changes }, adminUser, tdb, { skipOptimisticLock: true }),
      ).rejects.toMatchObject({ details: { reason: FrameworkReasons.subjectErased } });

      const updated = await kmsCrud.update({ id, changes }, adminUser, tdb, {
        skipOptimisticLock: true,
        writePurpose: WritePurposes.erasure,
      });

      expect(updated.isSuccess).toBe(true);
      const previous = await loadStoredPrevious("esExecPiiSoft.updated", id);
      expect(previous["email"]).toBe(PII_ERASED_SENTINEL);
    },
  );

  test.each(KEY_STATES)(
    "erased subject (%s): erasure update leaves other subjects' fields encrypted",
    async (keyState) => {
      const id = await createPreKmsRowWithErasedSubject(keyState);

      const updated = await kmsCrud.update(
        { id, changes: { ownerSecret: "owner-secret-after" } },
        adminUser,
        tdb,
        { skipOptimisticLock: true, writePurpose: WritePurposes.erasure },
      );

      expect(updated.isSuccess).toBe(true);
      const rows = (await asRawClient(testDb.db).unsafe(
        `SELECT payload FROM kumiko_events WHERE type = 'esExecPiiSoft.updated' AND aggregate_id = '${id}'`,
      )) as Array<{ payload: { changes: Record<string, unknown> } }>;
      expect(String(rows[0]?.payload.changes["ownerSecret"])).toStartWith(PII_CIPHERTEXT_PREFIX);
    },
  );

  test.each(KEY_STATES)(
    "erased subject (%s): forget succeeds on a pre-KMS plaintext row and removes it",
    async (keyState) => {
      const id = await createPreKmsRowWithErasedSubject(keyState);

      const forgotten = await kmsCrud.forget({ id }, adminUser, tdb);

      expect(forgotten.isSuccess).toBe(true);
      const rows = (await asRawClient(testDb.db).unsafe(
        `SELECT id FROM read_es_exec_pii_soft WHERE id = '${id}'`,
      )) as Array<{ id: unknown }>;
      expect(rows).toHaveLength(0);
      const previous = await loadStoredPrevious("esExecPiiSoft.forgotten", id);
      expect(previous["email"]).toBe(PII_ERASED_SENTINEL);
    },
  );

  test.each(KEY_STATES)(
    "erased subject (%s): after an erasure delete, restore stays refused",
    async (keyState) => {
      const id = await createPreKmsRowWithErasedSubject(keyState);

      const deleted = await kmsCrud.delete({ id }, adminUser, tdb, {
        writePurpose: WritePurposes.erasure,
      });

      expect(deleted.isSuccess).toBe(true);
      await expectRestoreRefusedAndNothingStored(id);
    },
  );
});
