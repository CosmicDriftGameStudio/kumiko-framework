// Live==Rebuild-Equivalence für die ImplicitProjection (Sprint G).
//
// Beweist: für jede r.entity erzeugt der EventStoreExecutor (live) und
// rebuildProjection (replay über Implicit-Projection) **denselben**
// Tabellen-Stand. Ohne diesen Test können live + rebuild zwischen den
// Releases auseinanderdriften (z.B. wenn jemand die Live-Schreib-Logik
// im Executor ändert ohne applyEntityEvent anzupassen).
//
// Test-Strategie:
//   1. Live: 4 Aggregate mit verschiedenen Lifecycles (create / update /
//      soft-delete / restore) durch den EventStoreExecutor jagen
//   2. Snapshot der Entity-Tabelle (nach Sortierung — ORDER BY id)
//   3. TRUNCATE der Entity-Tabelle
//   4. rebuildProjection für die ImplicitProjection
//   5. Snapshot erneut nehmen
//   6. deep-equal: identische Rows in identischer Reihenfolge

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { type BunTestDb, createTestDb } from "../../bun-db/__tests__/bun-test-db";
import { createBooleanField, createEntity, createTextField, defineFeature } from "../../engine";
import { createRegistry } from "../../engine/registry";
import { createEventsTable } from "../../event-store";
import { rebuildProjection } from "../../pipeline";
import { createProjectionStateTable } from "../../pipeline/projection-state";
import { TestUsers, unsafeCreateEntityTable } from "../../stack";
import { ensureTemporalPolyfill } from "../../time/polyfill";
import { createEventStoreExecutor } from "../event-store-executor";
import { buildEntityTable } from "../table-builder";
import { createTenantDb, type TenantDb } from "../tenant-db";

const userEntity = createEntity({
  table: "read_implicit_users",
  fields: {
    email: createTextField({ required: true }),
    firstName: createTextField(),
    isEnabled: createBooleanField({ default: true }),
  },
  softDelete: true,
});

const userFeature = defineFeature("implicittest", (r) => {
  r.entity("user", userEntity);
});

const userTable = buildEntityTable("user", userEntity);

let testDb: BunTestDb;
let tdb: TenantDb;
const adminUser = TestUsers.admin;

beforeAll(async () => {
  await ensureTemporalPolyfill();
  testDb = await createTestDb();
  await unsafeCreateEntityTable(testDb.db, userEntity, "user");
  await createEventsTable(testDb.db);
  await createProjectionStateTable(testDb.db);
  tdb = createTenantDb(testDb.db, adminUser.tenantId);
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

    // 1. Live writes — verschiedene Lifecycle-Pfade über die 4 Aggregate.
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

    const c = await crud.create({ email: "c@test.de", firstName: "Carol" }, adminUser, tdb);
    if (!c.isSuccess) throw new Error("setup C failed");
    await crud.delete({ id: c.data.id }, adminUser, tdb);
    await crud.restore({ id: c.data.id }, adminUser, tdb);

    await crud.create({ email: "d@test.de", firstName: "Dave" }, adminUser, tdb);

    const liveSnapshot = await snapshotTable();

    // Konkrete Erwartung an den Live-Stand: 4 erzeugte Aggregate, B ist
    // soft-deleted (isDeleted=true), C ist restored (isDeleted=false),
    // A und D sind unangetastet. Wenn das nicht stimmt, ist der Test
    // setup buggy bevor wir den Rebuild überhaupt vergleichen.
    expect(liveSnapshot).toHaveLength(4);
    const byEmail = new Map(liveSnapshot.map((r) => [r["email"] as string, r]));
    expect(byEmail.get("a@test.de")).toMatchObject({
      firstName: "Alice Updated",
      version: 2,
      isDeleted: false,
    });
    expect(byEmail.get("b@test.de")).toMatchObject({
      isEnabled: false,
      version: 3,
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

    // 2. Rebuild from event-log — registry baut die ImplicitProjection,
    //    rebuildProjection findet sie über getAllProjections().
    const registry = createRegistry([userFeature]);
    const implicitName = "implicittest:projection:user-entity";
    expect(registry.getAllProjections().has(implicitName)).toBe(true);

    const result = await rebuildProjection(implicitName, {
      db: testDb.db,
      registry,
    });

    // 4 creates + 2 updates + 2 deletes + 1 restore = 9 Events. Wenn
    // die ImplicitProjection silently nichts apply'd hätte, wäre der
    // Count 0 — der Test würde dann den nachfolgenden deep-equal trotzdem
    // verfehlen, aber explizit der Count fängt den Sub-Bug "apply lief,
    // aber für die falsche Event-Anzahl".
    expect(result.eventsProcessed).toBe(9);

    // 3. Vergleich. Erst ID-für-ID strikt prüfen damit klar ist welche
    // Felder verglichen werden — dann das Array-deep-equal als Catch-all.
    const rebuildSnapshot = await snapshotTable();
    expect(rebuildSnapshot).toHaveLength(liveSnapshot.length);
    for (let i = 0; i < liveSnapshot.length; i++) {
      const live = liveSnapshot[i];
      const rebuilt = rebuildSnapshot[i];
      // Diese Felder sind die User-sichtbare Truth (was sieht die UI?
      // was schreibt der Audit-Log?). Wenn eines davon driftet, ist
      // Live==Rebuild nicht mehr gegeben.
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
    // Catch-all: irgendein Feld das wir nicht explizit listen?
    expect(rebuildSnapshot).toEqual(liveSnapshot);
  });

  test("ImplicitProjection ist im Registry registriert mit korrekten apply-keys", () => {
    const registry = createRegistry([userFeature]);
    const projection = registry.getAllProjections().get("implicittest:projection:user-entity");
    expect(projection).toBeDefined();
    if (!projection) return;
    // Auto-Verben: created/updated/deleted/forgotten immer, restored nur bei softDelete=true
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
      fields: { name: createTextField({ required: true }) },
    });
    const hardFeature = defineFeature("implicithard", (r) => {
      r.entity("widget", hardDeleteEntity);
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

// Sensitive-Rebuild-Parität (#967): das Event-Log trägt für sensitive-Felder
// den Tabellen-Ciphertext (boot-validiert pii/encrypted) — Live==Rebuild gilt
// damit auch für sensitive Spalten + Blind-Index. Einzige legitime Divergenz
// bleibt Crypto-Shredding: DEK erased → bidx NULL, Wert unlesbar.

import {
  computeBlindIndex,
  configureBlindIndexKey,
  configurePiiSubjectKms,
  decodeBlindIndexKey,
  decryptPiiFieldValues,
  InMemoryKmsAdapter,
  isPiiCiphertext,
  resetBlindIndexKeyForTests,
  resetPiiSubjectKmsForTests,
} from "../../crypto";
import { asRawClient, selectMany } from "../../db/query";

const sensitiveTable = "read_implicit_sensitive_users";
const SENSITIVE_BIDX_KEY_B64 = Buffer.alloc(32, 9).toString("base64");
const SENSITIVE_BIDX_KEY = decodeBlindIndexKey(SENSITIVE_BIDX_KEY_B64);

const sensitiveEntity = createEntity({
  table: sensitiveTable,
  fields: {
    email: createTextField({ required: true }),
    apiKey: createTextField({ sensitive: true, pii: true, lookupable: true }),
  },
});

const sensitiveFeature = defineFeature("implicitsensitive", (r) => {
  r.entity("sensitive-user", sensitiveEntity);
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

    // Event-Payload trägt exakt den Tabellen-Ciphertext (byte-gleich).
    const { eventsTable } = await import("../../event-store");
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

    // Created-Event (v1-Ciphertext) muss mit dem aktuellen DEK lesbar bleiben —
    // eine DEK-Rotation beim Update würde das immutable Log unlesbar machen.
    const { eventsTable } = await import("../../event-store");
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

    // Rebuild spielt created+updated: bidx-Recompute entschlüsselt beide
    // Ciphertexte — schlägt bei rotiertem DEK fehl statt still zu heilen.
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
    // Ciphertext-Bytes werden kopiert, sind aber ohne DEK unlesbar.
    expect(isPiiCiphertext(rebuiltRow["api_key"])).toBe(true);
    expect(rebuiltRow["api_key"]).not.toBe("gone-after-forget");
  });
});
