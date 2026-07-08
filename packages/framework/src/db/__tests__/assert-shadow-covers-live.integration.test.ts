// Runtime guard #722: before the rebuild swaps the shadow over the live table,
// assert the shadow (deterministic event replay) reproduces every live row.
// Catches drift the static CI guard can't — direct-written state already in the
// live table (the #494/#523/#525 class) — by aborting the swap instead of
// silently dropping it.
//
// Strategy per case: build a live table via the EventStoreExecutor (rows backed
// by events), then introduce ONE row of drift with no matching event, and prove
// rebuildProjection throws + leaves the live table untouched (the swap that
// would have wiped/resurrected never runs because the tx rolls back).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { type BunTestDb, createTestDb } from "../../bun-db/__tests__/bun-test-db";
import { asRawClient, insertOne, selectMany } from "../../db/query";
import { createBooleanField, createEntity, createTextField, defineFeature } from "../../engine";
import { createRegistry } from "../../engine/registry";
import { createEventsTable } from "../../event-store";
import { rebuildProjection } from "../../pipeline";
import { createProjectionStateTable } from "../../pipeline/projection-state";
import { TestUsers, unsafeCreateEntityTable } from "../../stack";
import { createTestEnvelopeCipher } from "../../testing";
import { ensureTemporalPolyfill } from "../../time/polyfill";
import { collectEncryptedFieldNames, decryptEntityFieldValues } from "../entity-field-encryption";
import { createEventStoreExecutor } from "../event-store-executor";
import { buildEntityTable } from "../table-builder";
import { createTenantDb, type TenantDb } from "../tenant-db";

const userEntity = createEntity({
  table: "read_unreachable_users",
  fields: {
    email: createTextField({ required: true }),
    firstName: createTextField(),
    isEnabled: createBooleanField({ default: true }),
  },
  softDelete: true,
});

const userFeature = defineFeature("unreachabletest", (r) => {
  r.entity("user", userEntity);
});

const userTable = buildEntityTable("user", userEntity);
const projectionName = "unreachabletest:projection:user-entity";

// A `sensitive` field is stripped from the event log by design → replay leaves
// it NULL while live holds the value. The guard must NOT read that as drift,
// or no implicit projection with a sensitive field could ever be rebuilt.
const secretEntity = createEntity({
  table: "read_unreachable_secrets",
  fields: {
    email: createTextField({ required: true }),
    apiKey: createTextField({ sensitive: true }),
  },
});
const secretFeature = defineFeature("unreachablesecret", (r) => {
  r.entity("secret", secretEntity);
});
const secretTable = buildEntityTable("secret", secretEntity);
const secretProjection = "unreachablesecret:projection:secret-entity";

// An `encrypted` field stores the SAME ciphertext in the event and the live
// row (encrypted once), and replay copies the event's ciphertext into the
// shadow — deterministic, so the guard must not fire on the opaque column.
// This is the production-default path (user email/name), so it earns a test.
const TEST_KEY = Buffer.from("a]bJm#kP9xQ2@wN!vL$hR5yT8eU0iO3f").toString("base64");
const encEntity = createEntity({
  table: "read_unreachable_encrypted",
  fields: {
    email: createTextField({ required: true }),
    secretNote: createTextField({ encrypted: true }),
  },
});
const encFeature = defineFeature("unreachableenc", (r) => {
  r.entity("enc", encEntity);
});
const encTable = buildEntityTable("enc", encEntity);
const encProjection = "unreachableenc:projection:enc-entity";

const registry = createRegistry([userFeature, secretFeature, encFeature]);

let testDb: BunTestDb;
let tdb: TenantDb;
const adminUser = TestUsers.admin;

beforeAll(async () => {
  await ensureTemporalPolyfill();
  testDb = await createTestDb();
  await unsafeCreateEntityTable(testDb.db, userEntity, "user");
  await unsafeCreateEntityTable(testDb.db, secretEntity, "secret");
  await unsafeCreateEntityTable(testDb.db, encEntity, "enc");
  await createEventsTable(testDb.db);
  await createProjectionStateTable(testDb.db);
  tdb = createTenantDb(testDb.db, adminUser.tenantId);
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await asRawClient(testDb.db).unsafe(
    `TRUNCATE kumiko_events, read_unreachable_users, read_unreachable_secrets, read_unreachable_encrypted, kumiko_projections RESTART IDENTITY CASCADE`,
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

describe("assert-shadow-covers-live / #722 unreachable-state guard", () => {
  test("clean executor-only projection rebuilds without firing the guard", async () => {
    const crud = createEventStoreExecutor(userTable, userEntity, { entityName: "user" });
    await crud.create({ email: "a@test.de", firstName: "Alice" }, adminUser, tdb);
    await crud.create({ email: "b@test.de", firstName: "Bob" }, adminUser, tdb);
    const before = await snapshotTable();

    const result = await rebuildProjection(projectionName, { db: testDb.db, registry });

    // No false positive: the shadow reproduces the live table byte-for-byte
    // (same explicit-column diff the guard runs), so the swap proceeds.
    expect(result.eventsProcessed).toBe(2);
    expect(await snapshotTable()).toEqual(before);
  });

  test("direct-written live row with no event → swap aborts, live untouched", async () => {
    const crud = createEventStoreExecutor(userTable, userEntity, { entityName: "user" });
    const a = await crud.create({ email: "a@test.de", firstName: "Alice" }, adminUser, tdb);
    if (!a.isSuccess) throw new Error("setup failed");

    // Drift: clone the event-backed row into a second id WITHOUT appending an
    // event — the pre-fix #494/#523 hot-path bug. Replay can't reconstruct it.
    const [liveRow] = await selectMany(testDb.db, userTable, { id: a.data.id as string });
    if (!liveRow) throw new Error("live row missing");
    const driftId = crypto.randomUUID();
    // Deliberately bypass the EXECUTOR_ONLY brand: the whole point is to write
    // the entity table WITHOUT going through the executor (no event) — exactly
    // the production bug the guard defends against.
    const writable = userTable as unknown as Parameters<typeof insertOne>[1];
    await insertOne(tdb, writable, { ...liveRow, id: driftId, email: "ghost@test.de" });
    expect(await snapshotTable()).toHaveLength(2);

    await expect(rebuildProjection(projectionName, { db: testDb.db, registry })).rejects.toThrow(
      /not reproducible from its event log/,
    );

    // Swap never ran: both rows — including the un-eventful drift row — survive.
    const after = await snapshotTable();
    expect(after).toHaveLength(2);
    expect(after.map((r) => r["id"])).toContain(driftId);
  });

  test("direct-deleted live row with a create event → replay would resurrect → swap aborts", async () => {
    const crud = createEventStoreExecutor(userTable, userEntity, { entityName: "user" });
    const a = await crud.create({ email: "a@test.de", firstName: "Alice" }, adminUser, tdb);
    if (!a.isSuccess) throw new Error("setup failed");

    // Drift: delete the live row directly, no delete event — the GDPR-forget
    // hot-path (#494). Replay of the surviving create event would resurrect it.
    await asRawClient(testDb.db).unsafe(`DELETE FROM read_unreachable_users WHERE id = $1`, [
      a.data.id,
    ]);
    expect(await snapshotTable()).toHaveLength(0);

    await expect(rebuildProjection(projectionName, { db: testDb.db, registry })).rejects.toThrow(
      /RESURRECT/,
    );

    // Swap never ran: the deleted row stays gone (not silently resurrected).
    expect(await snapshotTable()).toHaveLength(0);
  });

  test("sensitive field (stripped from event log) does not trip the guard", async () => {
    const crud = createEventStoreExecutor(secretTable, secretEntity, { entityName: "secret" });
    const created = await crud.create({ email: "x@test.de", apiKey: "secret-abc" }, adminUser, tdb);
    if (!created.isSuccess) throw new Error("setup failed");

    // Live holds apiKey; the replay shadow leaves it NULL (by-design strip). The
    // guard excludes sensitive columns, so the rebuild proceeds instead of aborting.
    await rebuildProjection(secretProjection, { db: testDb.db, registry });

    const [rebuilt] = await selectMany(testDb.db, secretTable, { id: created.data.id as string });
    expect(rebuilt?.["email"]).toBe("x@test.de");
    expect(rebuilt?.["apiKey"]).toBeNull();
  });

  test("encrypted field (same ciphertext in event + live) does not trip the guard", async () => {
    const cipher = createTestEnvelopeCipher(TEST_KEY);
    const crud = createEventStoreExecutor(encTable, encEntity, {
      entityName: "enc",
      encryption: cipher,
    });
    const created = await crud.create(
      { email: "e@test.de", secretNote: "top-secret" },
      adminUser,
      tdb,
    );
    if (!created.isSuccess) throw new Error("setup failed");

    // Replay copies the event's ciphertext into the shadow (no re-encrypt), so
    // live and shadow hold the identical opaque blob — the guard sees no drift.
    await rebuildProjection(encProjection, { db: testDb.db, registry });

    const [rebuilt] = await selectMany(testDb.db, encTable, { id: created.data.id as string });
    if (!rebuilt) throw new Error("rebuilt row missing");
    // Ciphertext survived the rebuild intact — decrypts back to the original.
    const decrypted = await decryptEntityFieldValues(
      rebuilt,
      collectEncryptedFieldNames(encEntity),
      cipher,
    );
    expect(decrypted["secretNote"]).toBe("top-secret");
  });
});
