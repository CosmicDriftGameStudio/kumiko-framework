import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { InMemoryKmsAdapter, PII_ERASED_SENTINEL } from "../../crypto";
import { asRawClient } from "../../db/query";
import { createBooleanField, createEntity, createTextField } from "../../engine";
import { append, createEventsTable, loadEventsAfterVersion } from "../../event-store";
import type { EntityCache } from "../../pipeline/entity-cache";
import {
  createTestDb,
  type TestDb,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
} from "../../stack";
import { createTestEnvelopeCipher } from "../../testing";
import { applyEntityEvent } from "../apply-entity-event";
import { resetEntityFieldEncryptionCacheForTests } from "../entity-field-encryption";
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

describe("event-store-executor — detail liefert die Stream-Version", () => {
  const crud = createEventStoreExecutor(table, entity, { entityName: "esExecUser" });

  // Lifecycle-Writes (ctx.appendEvent) bumpen den Stream, ohne row.version
  // anzufassen — gäbe detail die stale Row-Version heraus, liefe jedes
  // darauf gebaute CRUD-Update (entityEdit nutzt detail.version als
  // optimistic-lock-Basis) in ein garantiertes version_conflict.
  // Prod-Repro: incident:open appended das Eröffnungs-Update → Stream v2,
  // Row v1 → incident-edit konnte nie speichern.
  test("nach ctx.appendEvent-artigem Stream-Bump: detail.version == Stream, Update damit erfolgreich", async () => {
    const created = await crud.create({ email: "stream@test.de" }, adminUser, tdb);
    expect(created.isSuccess).toBe(true);
    if (!created.isSuccess) return;
    const id = created.data.id;

    // Hand-emittiertes Event auf demselben Aggregat (wie incident:post-update).
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
});

const ENCRYPTION_TEST_KEY = Buffer.from("a]bJm#kP9xQ2@wN!vL$hR5yT8eU0iO3f").toString("base64");
const encryptedEntity = createEntity({
  table: "read_es_exec_encrypted",
  fields: {
    email: createTextField({ required: true }),
    secretNote: createTextField({ encrypted: true }),
  },
});
const encryptedTable = buildEntityTable("esExecEncrypted", encryptedEntity);

const encryptedSoftDeleteEntity = createEntity({
  table: "read_es_exec_enc_soft",
  fields: {
    email: createTextField({ required: true }),
    secretNote: createTextField({ encrypted: true }),
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
    store.set(storeKey, { ...store.get(storeKey)!, email: "from-cache@test.de" });

    const second = await cachedCrud.detail({ id }, adminUser, tdb);
    expect(second?.["email"]).toBe("from-cache@test.de");
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

// PII subject encryption (crypto-shredding, #724 phase C): pii/userOwned/
// tenantOwned fields are encrypted with the erase subject's DEK. Event
// payload AND projection row carry ciphertext (live == rebuild); erasing the
// subject key renders every value as the [[erased]] sentinel without
// touching the immutable log.
const piiEntity = createEntity({
  table: "read_es_exec_pii",
  fields: {
    email: createTextField({ required: true, pii: true }),
    note: createTextField({ userOwned: { ownerField: "authorId" } }),
    authorId: createTextField(),
    plain: createTextField(),
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
    expect(rawRows[0]!.email).toStartWith(`kumiko-pii:v1:user:${result.data.id}:`);
    expect(rawRows[0]!.plain).toBe("visible");

    const events = (await asRawClient(testDb.db).unsafe(
      `SELECT payload FROM kumiko_events WHERE type = 'esExecPii.created' LIMIT 1`,
    )) as Array<{ payload: { email?: string } }>;
    expect(events[0]?.payload.email).toStartWith("kumiko-pii:v1:");

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
    expect(rawRows[0]!.note).toStartWith(`kumiko-pii:v1:user:${TestUsers.admin.id}:`);
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
    // plaintext payload since #820 and must not be used as a replay source.
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
    const applied = await applyEntityEvent(storedEvent, piiTable, piiEntity, tdb.raw);
    expect(applied.kind).toBe("applied");

    const rawRows = (await asRawClient(testDb.db).unsafe(
      `SELECT email FROM read_es_exec_pii LIMIT 1`,
    )) as Array<{ email: string }>;
    expect(rawRows[0]!.email).toStartWith("kumiko-pii:v1:");
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
