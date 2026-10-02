// Blind-Index end-to-end (#818): create/update schreiben die bidx-Spalte
// (nie ins Event-Log), Equality-Lookups matchen über den OR-Rewrite sowohl
// verschlüsselte als auch Klartext-Alt-Rows, Rebuild recomputet bidx aus
// dem Ciphertext (erased → NULL), und der Forget-Sweep nullt sofort.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  resetBlindIndexKeyForTests,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-framework/testing";
import {
  computeBlindIndex,
  configureBlindIndexKey,
  configurePiiSubjectKms,
  decodeBlindIndexKey,
  InMemoryKmsAdapter,
  isPiiCiphertext,
  subjectIdToKey,
} from "../../crypto/index.js";
import { defineFeature } from "../../engine/define-feature.js";
import { createEntity, createTextField } from "../../engine/factories.js";
import { createRegistry } from "../../engine/registry.js";
import { rebuildProjection } from "../../pipeline/index.js";
import { createProjectionStateTable } from "../../pipeline/projection-state.js";
import {
  createTestDb,
  type TestDb,
  TestUsers,
  unsafeCreateEntityTable,
} from "../../stack/index.js";
import { nullBlindIndexesForSubject, subjectRowExistsInTenant } from "../blind-index-cleanup.js";
import { createEventStoreExecutor } from "../event-store-executor.js";
import { asRawClient, fetchOne } from "../query.js";
import { buildEntityTable } from "../table-builder.js";
import { createTenantDb, type TenantDb } from "../tenant-db.js";

const TEST_KEY_B64 = Buffer.alloc(32, 7).toString("base64");
const TEST_KEY = decodeBlindIndexKey(TEST_KEY_B64);

const personEntity = createEntity({
  table: "read_bidx_persons",
  fields: {
    email: createTextField({ required: true, personal: "self", find: "exact" }),
    firstName: createTextField({ personal: false, reason: "test_fixture" }),
  },
});
const personFeature = defineFeature("bidxtest", (r) => {
  r.entity("person", personEntity);
});
const personTable = buildEntityTable("person", personEntity);

// Lookupable entity whose read table is deliberately never created — used to
// prove the forget sweep skips missing relations (fw#2550).
const ghostEntity = createEntity({
  table: "read_bidx_ghosts_missing",
  fields: {
    email: createTextField({ required: true, personal: "self", find: "exact" }),
  },
});
const ghostFeature = defineFeature("bidxghost", (r) => {
  r.entity("ghost", ghostEntity);
});

// Migrated table that predates the `phone` lookupable field: `phone` and
// `phone_bidx` are physically missing (feature version without migration).
const driftEntity = createEntity({
  table: "read_bidx_drift",
  fields: {
    email: createTextField({ required: true, personal: "self", find: "exact" }),
    phone: createTextField({ personal: "self", find: "exact" }),
  },
});
const driftFeature = defineFeature("bidxdrift", (r) => {
  r.entity("drift", driftEntity);
});

// Self-PII entity with a serial id: a uuid subject id can never match it, and
// probing it would throw "invalid input syntax for type integer".
const serialEntity = createEntity({
  table: "read_bidx_serial",
  idType: "serial",
  fields: {
    email: createTextField({ required: true, personal: "self", find: "exact" }),
  },
});
const serialFeature = defineFeature("bidxserial", (r) => {
  r.entity("serialrow", serialEntity);
});

let testDb: TestDb;
let tdb: TenantDb;
let kms: InMemoryKmsAdapter;
const adminUser = TestUsers.admin;

beforeAll(async () => {
  testDb = await createTestDb();
  await unsafeCreateEntityTable(testDb.db, personEntity, "person");
  await createProjectionStateTable(testDb.db);
  await unsafeCreateEntityTable(testDb.db, serialEntity, "serialrow");
  await asRawClient(testDb.db).unsafe(
    `CREATE TABLE IF NOT EXISTS read_bidx_drift (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, email text, email_bidx text)`,
  );
  tdb = createTenantDb(testDb.db, adminUser.tenantId);
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await asRawClient(testDb.db).unsafe(
    `TRUNCATE kumiko_events, read_bidx_persons, kumiko_projections RESTART IDENTITY CASCADE`,
  );
  kms = new InMemoryKmsAdapter();
  configurePiiSubjectKms(kms);
  configureBlindIndexKey(TEST_KEY_B64);
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
  resetBlindIndexKeyForTests();
});

const crud = createEventStoreExecutor(personTable, personEntity, { entityName: "person" });

async function rawRow(id: string): Promise<Record<string, unknown>> {
  const rows = await asRawClient(testDb.db).unsafe<Record<string, unknown>>(
    `SELECT * FROM read_bidx_persons WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new Error(`no row for ${id}`);
  return row;
}

describe("blind-index write path", () => {
  test("create: bidx in the row, ciphertext in the email column, NOTHING in the event", async () => {
    const created = await crud.create({ email: "marc@example.com" }, adminUser, tdb);
    if (!created.isSuccess) throw new Error("create failed");

    const row = await rawRow(String(created.data.id));
    expect(row["email_bidx"]).toBe(computeBlindIndex(TEST_KEY, "marc@example.com"));
    expect(isPiiCiphertext(row["email"])).toBe(true);

    // Executor-Response: plaintext email, kein bidx-Leak.
    expect(created.data.data["email"]).toBe("marc@example.com");
    expect("emailBidx" in created.data.data).toBe(false);

    const events = await asRawClient(testDb.db).unsafe<{ payload: unknown }>(
      `SELECT payload FROM kumiko_events WHERE aggregate_id = $1`,
      [String(created.data.id)],
    );
    const payloadText = JSON.stringify(events.map((e) => e.payload));
    expect(payloadText).not.toContain("bidx");
  });

  test("update recomputes bidx for the changed field", async () => {
    const created = await crud.create({ email: "old@example.com" }, adminUser, tdb);
    if (!created.isSuccess) throw new Error("create failed");
    await crud.update(
      { id: created.data.id, version: 1, changes: { email: "new@example.com" } },
      adminUser,
      tdb,
    );
    const row = await rawRow(String(created.data.id));
    expect(row["email_bidx"]).toBe(computeBlindIndex(TEST_KEY, "new@example.com"));
  });
});

describe("blind-index lookup (OR-rewrite)", () => {
  test("fetchOne by plaintext email finds the encrypted row", async () => {
    const created = await crud.create({ email: "marc@example.com" }, adminUser, tdb);
    if (!created.isSuccess) throw new Error("create failed");

    const hit = await fetchOne<Record<string, unknown>>(tdb, personTable, {
      email: "marc@example.com",
    });
    expect(hit).toBeDefined();
    expect(hit?.["id"]).toBe(created.data.id);
    // Read-Strip: bidx nie am Caller.
    expect(hit && "emailBidx" in hit).toBe(false);
    expect(hit && "email_bidx" in hit).toBe(false);

    expect(await fetchOne(tdb, personTable, { email: "other@example.com" })).toBeUndefined();
  });

  test("plaintext legacy row (written pre-rollout) still matches the same query", async () => {
    // Rollout-Zustand VOR KMS+Key: Klartext-Row, bidx NULL.
    resetPiiSubjectKmsForTests();
    resetBlindIndexKeyForTests();
    const legacy = await crud.create({ email: "legacy@example.com" }, adminUser, tdb);
    if (!legacy.isSuccess) throw new Error("create failed");
    const legacyRow = await rawRow(String(legacy.data.id));
    expect(legacyRow["email"]).toBe("legacy@example.com");
    expect(legacyRow["email_bidx"]).toBeNull();

    // Rollout an: dieselbe Query matcht über den Plaintext-Arm.
    configurePiiSubjectKms(kms);
    configureBlindIndexKey(TEST_KEY_B64);
    const hit = await fetchOne<Record<string, unknown>>(tdb, personTable, {
      email: "legacy@example.com",
    });
    expect(hit?.["id"]).toBe(legacy.data.id);
  });

  test("list filter eq matches the encrypted row and strips bidx", async () => {
    const created = await crud.create(
      { email: "marc@example.com", firstName: "Marc" },
      adminUser,
      tdb,
    );
    if (!created.isSuccess) throw new Error("create failed");

    const page = await crud.list(
      { filter: { field: "email", op: "eq", value: "marc@example.com" } },
      adminUser,
      tdb,
    );
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]?.["email"]).toBe("marc@example.com");
    expect(page.rows[0] && "emailBidx" in page.rows[0]).toBe(false);

    const miss = await crud.list(
      { filter: { field: "email", op: "eq", value: "nobody@example.com" } },
      adminUser,
      tdb,
    );
    expect(miss.rows).toHaveLength(0);
  });
});

describe("blind-index rebuild + forget", () => {
  const implicitName = "bidxtest:projection:person-entity";

  test("rebuild recomputes bidx from ciphertext (identical to live)", async () => {
    const created = await crud.create({ email: "marc@example.com" }, adminUser, tdb);
    if (!created.isSuccess) throw new Error("create failed");
    const liveBidx = (await rawRow(String(created.data.id)))["email_bidx"];

    const registry = createRegistry([personFeature]);
    expect(registry.getAllProjections().has(implicitName)).toBe(true);
    await rebuildProjection(implicitName, { db: testDb.db, registry });

    const rebuilt = await rawRow(String(created.data.id));
    expect(rebuilt["email_bidx"]).toBe(liveBidx);
    expect(rebuilt["email_bidx"]).toBe(computeBlindIndex(TEST_KEY, "marc@example.com"));
  });

  test("erased subject → rebuild sets bidx NULL, lookup stops matching", async () => {
    const created = await crud.create({ email: "marc@example.com" }, adminUser, tdb);
    if (!created.isSuccess) throw new Error("create failed");

    await kms.eraseKey({ kind: "user", userId: String(created.data.id) });

    const registry = createRegistry([personFeature]);
    await rebuildProjection(implicitName, { db: testDb.db, registry });

    const rebuilt = await rawRow(String(created.data.id));
    expect(rebuilt["email_bidx"]).toBeNull();
    expect(await fetchOne(tdb, personTable, { email: "marc@example.com" })).toBeUndefined();
  });

  test("erased subject → column drift excludes bidx (#916, not counted)", async () => {
    // Pre-swap, live still holds the OLD bidx hash while the shadow already
    // computed NULL for the erased subject — a real live-vs-shadow divergence,
    // but the exact legitimate class countColumnDrift is designed to ignore.
    const created = await crud.create({ email: "marc@example.com" }, adminUser, tdb);
    if (!created.isSuccess) throw new Error("create failed");

    await kms.eraseKey({ kind: "user", userId: String(created.data.id) });

    const registry = createRegistry([personFeature]);
    const result = await rebuildProjection(implicitName, { db: testDb.db, registry });

    expect(result.columnDriftCount).toBe(0);
    expect((await rawRow(String(created.data.id)))["email_bidx"]).toBeNull();
  });

  test("nullBlindIndexesForSubject nulls bidx immediately (no rebuild needed)", async () => {
    const created = await crud.create({ email: "marc@example.com" }, adminUser, tdb);
    if (!created.isSuccess) throw new Error("create failed");
    expect((await rawRow(String(created.data.id)))["email_bidx"]).not.toBeNull();

    await kms.eraseKey({ kind: "user", userId: String(created.data.id) });
    const registry = createRegistry([personFeature]);
    await nullBlindIndexesForSubject(
      testDb.db,
      registry.features,
      subjectIdToKey({ kind: "user", userId: String(created.data.id) }),
    );

    expect((await rawRow(String(created.data.id)))["email_bidx"]).toBeNull();
    expect(await fetchOne(tdb, personTable, { email: "marc@example.com" })).toBeUndefined();
  });

  test("nullBlindIndexesForSubject skips missing projection tables (fw#2550)", async () => {
    const created = await crud.create({ email: "marc@example.com" }, adminUser, tdb);
    if (!created.isSuccess) throw new Error("create failed");
    expect((await rawRow(String(created.data.id)))["email_bidx"]).not.toBeNull();

    await kms.eraseKey({ kind: "user", userId: String(created.data.id) });
    // Registry includes a lookupable ghost whose table was never migrated —
    // pre-fix this UPDATE threw after eraseKey and left bidx linkable.
    const registry = createRegistry([personFeature, ghostFeature]);
    await expect(
      nullBlindIndexesForSubject(
        testDb.db,
        registry.features,
        subjectIdToKey({ kind: "user", userId: String(created.data.id) }),
      ),
    ).resolves.toBeUndefined();

    expect((await rawRow(String(created.data.id)))["email_bidx"]).toBeNull();
  });

  test("nullBlindIndexesForSubject skips lookupable fields whose columns are missing", async () => {
    const created = await crud.create({ email: "marc@example.com" }, adminUser, tdb);
    if (!created.isSuccess) throw new Error("create failed");
    const subjectId = String(created.data.id);
    await asRawClient(testDb.db).unsafe(
      `INSERT INTO read_bidx_drift (id, tenant_id, email, email_bidx) VALUES ($1, $2, $3, 'h')`,
      [subjectId, adminUser.tenantId, `kumiko-pii:v1:user:${subjectId}:x`],
    );
    await kms.eraseKey({ kind: "user", userId: subjectId });

    const registry = createRegistry([personFeature, driftFeature]);
    await nullBlindIndexesForSubject(
      testDb.db,
      registry.features,
      subjectIdToKey({ kind: "user", userId: subjectId }),
    );

    const driftRows = await asRawClient(testDb.db).unsafe<Record<string, unknown>>(
      `SELECT email_bidx FROM read_bidx_drift WHERE id = $1`,
      [subjectId],
    );
    expect(driftRows[0]?.["email_bidx"]).toBeNull();
    expect((await rawRow(subjectId))["email_bidx"]).toBeNull();
  });

  test("subjectRowExistsInTenant ignores serial-id self-PII entities instead of throwing", async () => {
    const registry = createRegistry([serialFeature]);
    await expect(
      subjectRowExistsInTenant(
        testDb.db,
        registry.features,
        "11111111-1111-4111-8111-111111111111",
        adminUser.tenantId,
      ),
    ).resolves.toBe(false);
  });
});
