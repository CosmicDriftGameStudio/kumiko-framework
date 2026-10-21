// Live==Rebuild equivalence for the ImplicitProjection.
//
// Proves that, for every r.entity, EventStoreExecutor (live) and
// rebuildProjection (replay through the implicit projection) produce the
// **same** table state. Without this test, live and rebuild can drift apart
// between releases, for example if someone changes the live write logic in
// the executor without updating applyEntityEvent accordingly.
//
// Test strategy:
//   1. Live: run 4 aggregates with different lifecycles (create / update /
//      soft-delete / restore) through EventStoreExecutor
//   2. Snapshot the entity table (sorted with ORDER BY id)
//   3. TRUNCATE the entity table
//   4. Run rebuildProjection for the ImplicitProjection
//   5. Take another snapshot
//   6. Deep-equal: identical rows in identical order

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { unsafeCreateEntityTable } from "@cosmicdrift/kumiko-testing/stack";
import {
  createBooleanField,
  createEntity,
  createTextField,
  defineFeature,
} from "../../engine/index.ts";
import { createRegistry } from "../../engine/registry.ts";
import { rebuildProjection } from "../../pipeline/index.ts";
import { createProjectionStateTable } from "../../pipeline/projection-state.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import { ensureTemporalPolyfill } from "../../time/polyfill.ts";
import { createEventStoreExecutor } from "../event-store-executor.ts";
import { buildEntityTable } from "../table-builder.ts";
import { createTenantDb, type TenantDb } from "../tenant-db.ts";
import { type BunTestDb, createTestDb } from "./query/bun-test-db.ts";

const userEntity = createEntity({
  table: "read_implicit_users",
  fields: {
    email: createTextField({ required: true, personal: false, reason: "test_fixture" }),
    firstName: createTextField({ personal: false, reason: "test_fixture" }),
    isEnabled: createBooleanField({ default: true }),
  },
  softDelete: true,
});

const userFeature = defineFeature("implicittest", (r) => {
  r.entity({ name: "user", ...userEntity });
});

const userTable = buildEntityTable("user", userEntity);

let testDb: BunTestDb;
let tdb: TenantDb;
const adminUser = TestUsers.admin;

beforeAll(async () => {
  await ensureTemporalPolyfill();
  testDb = await createTestDb();
  await unsafeCreateEntityTable(testDb.db, userEntity, "user");
  await createProjectionStateTable(testDb.db);
  tdb = createTenantDb({ db: testDb.db, tenantId: adminUser.tenantId });
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await asRawClient(testDb.db).unsafe(
    `TRUNCATE kumiko_events, read_implicit_users, kumiko_projections RESTART IDENTITY CASCADE`,
  );
});

async function snapshotTable(): Promise<readonly Record<string, unknown>[]> {
  const rows = await selectMany(
    testDb.db,
    userTable,
    {},
    { orderBy: { col: "id", direction: "asc" } },
  );
  return rows as readonly Record<string, unknown>[];
}

describe("implicit-projection / Live==Rebuild equivalence", () => {
  test("4 aggregates × create/update/delete/restore round-trip identical to rebuild", async () => {
    const crud = createEventStoreExecutor(userTable, userEntity, { entityName: "user" });

    // 1. Live writes — different lifecycle paths across the 4 aggregates.
    //    Aggregate A: create + update
    //    Aggregate B: create + update + delete (soft)
    //    Aggregate C: create + delete + restore
    //    Aggregate D: create only
    const a = await crud.create({ email: "a@test.de", firstName: "Alice" }, adminUser, tdb);
    if (!a.isSuccess) throw new Error("setup A failed");
    await crud.update(
      { id: a.data.id, version: 1, changes: { firstName: "Alice Updated" } },
      adminUser,
      tdb,
    );

    const b = await crud.create({ email: "b@test.de", firstName: "Bob" }, adminUser, tdb);
    if (!b.isSuccess) throw new Error("setup B failed");
    await crud.update({ id: b.data.id, version: 1, changes: { isEnabled: false } }, adminUser, tdb);
    await crud.delete({ id: b.data.id }, adminUser, tdb);
    // Update on the soft-deleted row (includeDeleted) must rebuild to the same row.
    const movedWhileDeleted = await crud.update(
      { id: b.data.id, version: 3, changes: { firstName: "Bob Moved" } },
      adminUser,
      tdb,
      { includeDeleted: true },
    );
    if (!movedWhileDeleted.isSuccess) throw new Error("setup B update-while-deleted failed");

    const c = await crud.create({ email: "c@test.de", firstName: "Carol" }, adminUser, tdb);
    if (!c.isSuccess) throw new Error("setup C failed");
    await crud.delete({ id: c.data.id }, adminUser, tdb);
    await crud.restore({ id: c.data.id }, adminUser, tdb);

    await crud.create({ email: "d@test.de", firstName: "Dave" }, adminUser, tdb);

    const liveSnapshot = await snapshotTable();

    // Expected live state: 4 aggregates were created; B is soft-deleted
    // (isDeleted=true), C is restored (isDeleted=false), and A and D are
    // unchanged. If this fails, the test setup is broken before the rebuild
    // comparison can run.
    expect(liveSnapshot).toHaveLength(4);
    const byEmail = new Map(liveSnapshot.map((r) => [r["email"] as string, r]));
    expect(byEmail.get("a@test.de")).toMatchObject({
      firstName: "Alice Updated",
      version: 2,
      isDeleted: false,
    });
    expect(byEmail.get("b@test.de")).toMatchObject({
      isEnabled: false,
      firstName: "Bob Moved",
      version: 4,
      isDeleted: true,
    });
    expect(byEmail.get("c@test.de")).toMatchObject({
      version: 3,
      isDeleted: false,
    });
    expect(byEmail.get("d@test.de")).toMatchObject({
      firstName: "Dave",
      version: 1,
      isDeleted: false,
    });

    // 2. Rebuild from the event log — the registry builds the implicit
    //    projection, and rebuildProjection finds it through getAllProjections().
    const registry = createRegistry([userFeature]);
    const implicitName = "implicittest:projection:user-entity";
    expect(registry.getAllProjections().has(implicitName)).toBe(true);

    const result = await rebuildProjection(implicitName, {
      db: testDb.db,
      registry,
    });

    // 4 creates + 3 updates + 2 deletes + 1 restore = 10 events. The explicit count
    // catches the sub-bug "apply ran, but for the wrong number of events", which the
    // deep-equal below alone could miss.
    expect(result.eventsProcessed).toBe(10);

    // 3. Compare. First check each row by ID and field so the compared fields
    //    are explicit, then use array deep-equality as a catch-all.
    const rebuildSnapshot = await snapshotTable();
    expect(rebuildSnapshot).toHaveLength(liveSnapshot.length);
    for (let i = 0; i < liveSnapshot.length; i++) {
      const live = liveSnapshot[i];
      const rebuilt = rebuildSnapshot[i];
      // These fields are the user-visible source of truth (what the UI sees and
      // what the audit log records). If any of them drifts, Live==Rebuild no
      // longer holds.
      const fields = [
        "id",
        "tenantId",
        "version",
        "email",
        "firstName",
        "isEnabled",
        "isDeleted",
        "insertedAt",
        "modifiedAt",
        "deletedAt",
        "insertedById",
        "modifiedById",
        "deletedById",
      ] as const;
      for (const f of fields) {
        expect(rebuilt?.[f], `field "${f}" at row ${i}`).toEqual(live?.[f]);
      }
    }
    // Catch-all for any field not listed explicitly above.
    expect(rebuildSnapshot).toEqual(liveSnapshot);
  });

  test("ImplicitProjection ist im Registry registriert mit korrekten apply-keys", () => {
    const registry = createRegistry([userFeature]);
    const projection = registry.getAllProjections().get("implicittest:projection:user-entity");
    expect(projection).toBeDefined();
    if (!projection) return;
    // Automatic verbs: created/updated/deleted/forgotten always; restored only when softDelete=true
    expect(Object.keys(projection.apply).sort()).toEqual([
      "user.created",
      "user.deleted",
      "user.forgotten",
      "user.restored",
      "user.updated",
    ]);
    expect(projection.source).toBe("user");
  });

  test("ohne softDelete → keine restore-apply-key registriert", () => {
    const hardDeleteEntity = createEntity({
      table: "read_implicit_hard",
      fields: {
        name: createTextField({ required: true, personal: false, reason: "test_fixture" }),
      },
    });
    const hardFeature = defineFeature("implicithard", (r) => {
      r.entity({ name: "widget", ...hardDeleteEntity });
    });
    const registry = createRegistry([hardFeature]);
    const projection = registry.getAllProjections().get("implicithard:projection:widget-entity");
    expect(projection).toBeDefined();
    if (!projection) return;
    expect(Object.keys(projection.apply).sort()).toEqual([
      "widget.created",
      "widget.deleted",
      "widget.forgotten",
      "widget.updated",
    ]);
  });
});

// Sensitive rebuild parity: the event log stores the table ciphertext for
// sensitive fields (validated at boot as pii/encrypted), so Live==Rebuild also
// applies to sensitive columns and the blind index. The only legitimate
// divergence is crypto-shredding: DEK erased → bidx NULL, value unreadable.

import {
  resetBlindIndexKeyForTests,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  computeBlindIndex,
  configureBlindIndexKey,
  configurePiiSubjectKms,
  decodeBlindIndexKey,
  decryptPiiFieldValues,
  InMemoryKmsAdapter,
  isPiiCiphertext,
} from "../../crypto/index.ts";
import { asRawClient, selectMany } from "../../db/query.ts";

const sensitiveTable = "read_implicit_sensitive_users";
const SENSITIVE_BIDX_KEY_B64 = Buffer.alloc(32, 9).toString("base64");
const SENSITIVE_BIDX_KEY = decodeBlindIndexKey(SENSITIVE_BIDX_KEY_B64);

const sensitiveEntity = createEntity({
  table: sensitiveTable,
  fields: {
    email: createTextField({ required: true, personal: false, reason: "test_fixture" }),
    apiKey: createTextField({ personal: "self", find: "exact" }),
  },
});

const sensitiveFeature = defineFeature("implicitsensitive", (r) => {
  r.entity({ name: "sensitive-user", ...sensitiveEntity });
});

const sensitiveEntityTable = buildEntityTable("sensitive-user", sensitiveEntity);
const sensitiveProjection = "implicitsensitive:projection:sensitive-user-entity";

describe("implicit-projection / sensitive Rebuild-Parität (#967)", () => {
  let kms: InMemoryKmsAdapter;

  beforeAll(async () => {
    await unsafeCreateEntityTable(testDb.db, sensitiveEntity, "sensitive-user");
  });

  beforeEach(async () => {
    await asRawClient(testDb.db).unsafe(
      `TRUNCATE ${sensitiveTable}, kumiko_events, kumiko_projections RESTART IDENTITY CASCADE`,
    );
    kms = new InMemoryKmsAdapter();
    configurePiiSubjectKms(kms);
    configureBlindIndexKey(SENSITIVE_BIDX_KEY_B64);
  });

  afterEach(() => {
    resetPiiSubjectKmsForTests();
    resetBlindIndexKeyForTests();
  });

  const crud = createEventStoreExecutor(sensitiveEntityTable, sensitiveEntity, {
    entityName: "sensitive-user",
  });

  async function rawSensitiveRow(id: string): Promise<Record<string, unknown>> {
    const rows = await asRawClient(testDb.db).unsafe<Record<string, unknown>>(
      `SELECT * FROM ${sensitiveTable} WHERE id = $1`,
      [id],
    );
    const row = rows[0];
    if (!row) throw new Error(`no row for ${id}`);
    return row;
  }

  test("Live==Rebuild inkl. sensitive-Ciphertext + bidx (byte-gleiche Kopie aus dem Event)", async () => {
    const created = await crud.create(
      { email: "x@test.de", apiKey: "secret-token-abc" },
      adminUser,
      tdb,
    );
    if (!created.isSuccess) throw new Error("setup failed");
    const id = String(created.data.id);

    // Live-Row: Ciphertext + bidx, nie Klartext.
    const liveRow = await rawSensitiveRow(id);
    const liveCipher = liveRow["api_key"];
    expect(isPiiCiphertext(liveCipher)).toBe(true);
    expect(liveRow["api_key_bidx"]).toBe(computeBlindIndex(SENSITIVE_BIDX_KEY, "secret-token-abc"));

    // The event payload contains the exact table ciphertext, byte-for-byte.
    const { eventsTable } = await import("../../event-store/index.ts");
    const [event] = await selectMany(
      testDb.db,
      eventsTable,
      { aggregateId: created.data.id },
      { orderBy: { col: "version", direction: "asc" } },
    );
    expect(event?.payload?.["apiKey"]).toBe(liveCipher);
    expect(event?.payload?.["email"]).toBe("x@test.de");
    expect(JSON.stringify(event?.payload)).not.toContain("secret-token-abc");

    const registry = createRegistry([sensitiveFeature]);
    await rebuildProjection(sensitiveProjection, { db: testDb.db, registry });

    const rebuiltRow = await rawSensitiveRow(id);
    expect(rebuiltRow["email"]).toBe("x@test.de");
    expect(rebuiltRow["api_key"]).toBe(liveCipher);
    expect(rebuiltRow["api_key_bidx"]).toBe(liveRow["api_key_bidx"]);
  });

  test("DEK-Stabilität: Update re-encryptet mit demselben Subject-DEK — alter Event-Ciphertext bleibt lesbar", async () => {
    const created = await crud.create(
      { email: "y@test.de", apiKey: "first-secret" },
      adminUser,
      tdb,
    );
    if (!created.isSuccess) throw new Error("setup failed");
    const updated = await crud.update(
      { id: created.data.id, version: 1, changes: { apiKey: "second-secret" } },
      adminUser,
      tdb,
    );
    if (!updated.isSuccess) throw new Error("update failed");

    // The created event's v1 ciphertext must remain readable with the current DEK —
    // rotating the DEK during the update would make the immutable log unreadable.
    const { eventsTable } = await import("../../event-store/index.ts");
    const [createdEvent] = await selectMany(
      testDb.db,
      eventsTable,
      { aggregateId: created.data.id },
      { orderBy: { col: "version", direction: "asc" } },
    );
    const v1Cipher = createdEvent?.payload?.["apiKey"];
    expect(isPiiCiphertext(v1Cipher)).toBe(true);
    const decrypted = await decryptPiiFieldValues({ apiKey: v1Cipher }, ["apiKey"], kms, {
      requestId: "test",
    });
    expect(decrypted["apiKey"]).toBe("first-secret");

    // Rebuild processes created+updated: recomputing bidx decrypts both
    // ciphertexts, so a rotated DEK fails rather than silently repairing the data.
    const registry = createRegistry([sensitiveFeature]);
    await rebuildProjection(sensitiveProjection, { db: testDb.db, registry });
    const rebuiltRow = await rawSensitiveRow(String(created.data.id));
    expect(rebuiltRow["api_key_bidx"]).toBe(computeBlindIndex(SENSITIVE_BIDX_KEY, "second-secret"));
  });

  test("Erase-Divergenz bleibt die einzige legitime: DEK erased → Rebuild bidx NULL, Wert unlesbar", async () => {
    const created = await crud.create(
      { email: "z@test.de", apiKey: "gone-after-forget" },
      adminUser,
      tdb,
    );
    if (!created.isSuccess) throw new Error("setup failed");
    const id = String(created.data.id);

    await kms.eraseKey({ kind: "user", userId: id });

    const registry = createRegistry([sensitiveFeature]);
    await rebuildProjection(sensitiveProjection, { db: testDb.db, registry });

    const rebuiltRow = await rawSensitiveRow(id);
    expect(rebuiltRow["api_key_bidx"]).toBeNull();
    // The ciphertext bytes are copied, but they cannot be read without the DEK.
    expect(isPiiCiphertext(rebuiltRow["api_key"])).toBe(true);
    expect(rebuiltRow["api_key"]).not.toBe("gone-after-forget");
  });
});
