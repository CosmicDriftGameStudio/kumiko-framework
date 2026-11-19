// backfillEventPiiEncryption, owner stages on a userOwned field with whenAbsent: "tenant": the
// re-key of tenant-keyed or previous-owner ciphertext, and the owner a slim update had at its event.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  resetBlindIndexKeyForTests,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  createTestDb,
  type TestDb,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  configurePiiSubjectKms,
  decryptPiiValueForSubject,
  encryptPiiValueForSubject,
  InMemoryKmsAdapter,
  PII_CIPHERTEXT_PREFIX,
  PII_ERASED_SENTINEL,
} from "../../crypto/index.ts";
import { backfillEventPiiEncryption } from "../../db/queries/backfill-pii.ts";
import { asRawClient } from "../../db/query.ts";
import { buildEntityTable } from "../../db/table-builder.ts";
import { defineFeature } from "../../engine/define-feature.ts";
import { createEntity, createTextField } from "../../engine/factories.ts";
import { createRegistry } from "../../engine/registry.ts";
import type { Registry, TenantId } from "../../engine/types/index.ts";
import { generateId } from "../../utils/index.ts";
import { append, loadAggregate } from "../event-store.ts";

const TENANT = "00000000-0000-4000-8000-000000000001" as TenantId;

const memoEntity = createEntity({
  name: "memo",
  fields: {
    ownerId: createTextField({ personal: "ref" }),
    body: createTextField({ personal: { of: "ownerId", whenAbsent: "tenant" }, find: "none" }),
  },
});
const memoTable = buildEntityTable(memoEntity);

const notesFeature = defineFeature("notes", (r) => {
  r.entity(memoEntity);
});

let testDb: TestDb;
let registry: Registry;
let kms: InMemoryKmsAdapter;

async function appendPlain(
  aggregateId: string,
  aggregateType: string,
  type: string,
  payload: Record<string, unknown>,
  expectedVersion = 0,
): Promise<void> {
  await append(testDb.db, {
    aggregateId,
    aggregateType,
    tenantId: TENANT,
    expectedVersion,
    type,
    payload,
    metadata: { userId: "system" },
  });
}

beforeAll(async () => {
  testDb = await createTestDb();
  registry = createRegistry([notesFeature]);
  await unsafeCreateEntityTable(testDb.db, memoEntity, "memo");
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  const raw = asRawClient(testDb.db);
  await raw.unsafe(`TRUNCATE "kumiko_events" RESTART IDENTITY`);
  await raw.unsafe(`TRUNCATE "${memoTable.tableName}"`);
  // Plaintext era: NO KMS while the legacy events are appended.
  resetPiiSubjectKmsForTests();
  resetBlindIndexKeyForTests();
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
  resetBlindIndexKeyForTests();
});

function armKms(): void {
  kms = new InMemoryKmsAdapter();
  configurePiiSubjectKms(kms);
}

describe("backfillEventPiiEncryption: owner re-key", () => {
  const REKEY = { resolveOwnerFromProjection: true, rekeyTenantKeyedOwnerFields: true } as const;
  const OTHER_TENANT = "00000000-0000-4000-8000-0000000000aa" as TenantId;

  async function createdBody(id: string): Promise<string> {
    const events = await loadAggregate(testDb.db, id, TENANT);
    return String((events[0]?.payload as Record<string, unknown> | undefined)?.["body"]);
  }

  // The state this stage exists for: created while ownerless (tenant key), owner known later.
  async function seedTenantKeyedMemo(
    projectionOwner: string | null,
    projectionTenant: TenantId = TENANT,
  ): Promise<string> {
    const memoId = generateId();
    await appendPlain(memoId, "memo", "memo.created", { id: memoId, body: "Alice" });
    armKms();
    const first = await backfillEventPiiEncryption(testDb.db, registry);
    expect(first.failures).toEqual([]);
    expect(await createdBody(memoId)).toContain(`tenant:${TENANT}`);
    await asRawClient(testDb.db).unsafe(
      `INSERT INTO "${memoTable.tableName}" (id, tenant_id, owner_id, body) VALUES ($1, $2, $3, $4)`,
      [memoId, projectionTenant, projectionOwner, "projection-row-body"],
    );
    return memoId;
  }

  test("tenant-keyed value moves under the projection owner and still decrypts", async () => {
    const user = generateId();
    const memoId = await seedTenantKeyedMemo(user);

    const result = await backfillEventPiiEncryption(testDb.db, registry, REKEY);

    expect(result.failures).toEqual([]);
    expect(result.rekeyedFields).toBe(1);
    expect(result.updatedEvents).toBe(1);
    const body = await createdBody(memoId);
    expect(body).toStartWith(`${PII_CIPHERTEXT_PREFIX}user:${user}:`);
    expect(await decryptPiiValueForSubject(kms, body, { requestId: "test" }, "body")).toBe("Alice");
  });

  test("projection owner null: the value stays tenant-keyed", async () => {
    const memoId = await seedTenantKeyedMemo(null);

    const result = await backfillEventPiiEncryption(testDb.db, registry, REKEY);

    expect(result.rekeyedFields).toBe(0);
    expect(await createdBody(memoId)).toContain(`tenant:${TENANT}`);
  });

  test("a projection row of another tenant with the same id names no owner", async () => {
    const memoId = await seedTenantKeyedMemo(generateId(), OTHER_TENANT);

    const result = await backfillEventPiiEncryption(testDb.db, registry, REKEY);

    expect(result.rekeyedFields).toBe(0);
    expect(await createdBody(memoId)).toContain(`tenant:${TENANT}`);
  });

  test("ciphertext keyed under another tenant is untouched", async () => {
    armKms();
    const user = generateId();
    const memoId = generateId();
    const foreign = await encryptPiiValueForSubject(
      kms,
      { kind: "tenant", tenantId: OTHER_TENANT },
      "Alice",
      { requestId: "test" },
      "body",
    );
    await appendPlain(memoId, "memo", "memo.created", { id: memoId, body: foreign });
    await asRawClient(testDb.db).unsafe(
      `INSERT INTO "${memoTable.tableName}" (id, tenant_id, owner_id, body) VALUES ($1, $2, $3, $4)`,
      [memoId, TENANT, user, "projection-row-body"],
    );

    const result = await backfillEventPiiEncryption(testDb.db, registry, REKEY);

    expect(result.rekeyedFields).toBe(0);
    expect(await createdBody(memoId)).toBe(foreign);
  });

  test("owner forgotten: the value becomes the erased sentinel", async () => {
    const user = generateId();
    const memoId = await seedTenantKeyedMemo(user);
    await kms.createKey({ kind: "user", userId: user });
    await kms.eraseKey({ kind: "user", userId: user });

    const result = await backfillEventPiiEncryption(testDb.db, registry, REKEY);

    expect(result.failures).toEqual([]);
    expect(result.rekeyedFields).toBe(0);
    expect(result.erasedFields).toBe(1);
    expect(await createdBody(memoId)).toBe(PII_ERASED_SENTINEL);
  });

  test("dryRun predicts the re-key and writes nothing", async () => {
    const user = generateId();
    const memoId = await seedTenantKeyedMemo(user);
    const before = await createdBody(memoId);

    const result = await backfillEventPiiEncryption(testDb.db, registry, {
      ...REKEY,
      dryRun: true,
    });

    expect(result.rekeyedFields).toBe(1);
    expect(await createdBody(memoId)).toBe(before);
  });

  test("without the option the tenant-keyed value is untouched", async () => {
    const memoId = await seedTenantKeyedMemo(generateId());
    const before = await createdBody(memoId);

    const result = await backfillEventPiiEncryption(testDb.db, registry, {
      resolveOwnerFromProjection: true,
    });

    expect(result.rekeyedFields).toBe(0);
    expect(result.updatedEvents).toBe(0);
    expect(await createdBody(memoId)).toBe(before);
  });

  test("a second run changes nothing", async () => {
    const memoId = await seedTenantKeyedMemo(generateId());
    await backfillEventPiiEncryption(testDb.db, registry, REKEY);
    const afterFirst = await createdBody(memoId);

    const second = await backfillEventPiiEncryption(testDb.db, registry, REKEY);

    expect(second.updatedEvents).toBe(0);
    expect(second.rekeyedFields).toBe(0);
    expect(await createdBody(memoId)).toBe(afterFirst);
  });

  test("owner changed X to Y before owner transitions re-keyed: the value moves under Y, Y's forget erases it", async () => {
    const userX = generateId();
    const userY = generateId();
    const memoId = generateId();
    await appendPlain(memoId, "memo", "memo.created", {
      id: memoId,
      ownerId: userX,
      body: "Alice",
    });
    await appendPlain(
      memoId,
      "memo",
      "memo.updated",
      { changes: { ownerId: userY }, previous: { id: memoId, ownerId: userX } },
      1,
    );
    await asRawClient(testDb.db).unsafe(
      `INSERT INTO "${memoTable.tableName}" (id, tenant_id, owner_id, body) VALUES ($1, $2, $3, $4)`,
      [memoId, TENANT, userY, "projection-row-body"],
    );
    armKms();
    const first = await backfillEventPiiEncryption(testDb.db, registry, {
      resolveOwnerFromProjection: true,
    });
    expect(first.failures).toEqual([]);
    expect(await createdBody(memoId)).toStartWith(`${PII_CIPHERTEXT_PREFIX}user:${userX}:`);

    const result = await backfillEventPiiEncryption(testDb.db, registry, REKEY);

    expect(result.failures).toEqual([]);
    expect(result.rekeyedFields).toBe(1);
    const body = await createdBody(memoId);
    expect(body).toStartWith(`${PII_CIPHERTEXT_PREFIX}user:${userY}:`);
    expect(await decryptPiiValueForSubject(kms, body, { requestId: "test" }, "body")).toBe("Alice");
    await kms.eraseKey({ kind: "user", userId: userY });
    expect(await decryptPiiValueForSubject(kms, body, { requestId: "test" }, "body")).toBe(
      PII_ERASED_SENTINEL,
    );
  });

  test("owner changed X to Y by the live path (newer event holds a Y copy): the older X value stays X-keyed, X's forget erases it", async () => {
    const userX = generateId();
    const userY = generateId();
    const memoId = generateId();
    await appendPlain(memoId, "memo", "memo.created", {
      id: memoId,
      ownerId: userX,
      body: "Alice",
    });
    armKms();
    await backfillEventPiiEncryption(testDb.db, registry);
    const copyUnderY = await encryptPiiValueForSubject(
      kms,
      { kind: "user", userId: userY },
      "Alice",
      { requestId: "test" },
      "body",
    );
    await appendPlain(
      memoId,
      "memo",
      "memo.updated",
      { changes: { ownerId: userY, body: copyUnderY }, previous: { id: memoId, ownerId: userX } },
      1,
    );
    await asRawClient(testDb.db).unsafe(
      `INSERT INTO "${memoTable.tableName}" (id, tenant_id, owner_id, body) VALUES ($1, $2, $3, $4)`,
      [memoId, TENANT, userY, "projection-row-body"],
    );

    const result = await backfillEventPiiEncryption(testDb.db, registry, REKEY);

    expect(result.failures).toEqual([]);
    expect(result.rekeyedFields).toBe(0);
    const body = await createdBody(memoId);
    expect(body).toStartWith(`${PII_CIPHERTEXT_PREFIX}user:${userX}:`);
    await kms.eraseKey({ kind: "user", userId: userX });
    expect(await decryptPiiValueForSubject(kms, body, { requestId: "test" }, "body")).toBe(
      PII_ERASED_SENTINEL,
    );
  });

  test("owner changed X to Y and a newer event cleared the field to null: the older X value is not re-keyed onto Y", async () => {
    const userX = generateId();
    const userY = generateId();
    const memoId = generateId();
    await appendPlain(memoId, "memo", "memo.created", {
      id: memoId,
      ownerId: userX,
      body: "Alice",
    });
    armKms();
    await backfillEventPiiEncryption(testDb.db, registry);
    await appendPlain(
      memoId,
      "memo",
      "memo.updated",
      { changes: { ownerId: userY, body: null }, previous: { id: memoId, ownerId: userX } },
      1,
    );
    await asRawClient(testDb.db).unsafe(
      `INSERT INTO "${memoTable.tableName}" (id, tenant_id, owner_id, body) VALUES ($1, $2, $3, $4)`,
      [memoId, TENANT, userY, null],
    );

    const result = await backfillEventPiiEncryption(testDb.db, registry, REKEY);

    expect(result.failures).toEqual([]);
    expect(result.rekeyedFields).toBe(0);
    expect(await createdBody(memoId)).toStartWith(`${PII_CIPHERTEXT_PREFIX}user:${userX}:`);
  });

  test("user-keyed value whose key is already erased becomes the erased sentinel", async () => {
    const userX = generateId();
    const memoId = generateId();
    await appendPlain(memoId, "memo", "memo.created", {
      id: memoId,
      ownerId: userX,
      body: "Alice",
    });
    await asRawClient(testDb.db).unsafe(
      `INSERT INTO "${memoTable.tableName}" (id, tenant_id, owner_id, body) VALUES ($1, $2, $3, $4)`,
      [memoId, TENANT, generateId(), "projection-row-body"],
    );
    armKms();
    await backfillEventPiiEncryption(testDb.db, registry);
    await kms.eraseKey({ kind: "user", userId: userX });

    const result = await backfillEventPiiEncryption(testDb.db, registry, REKEY);

    expect(result.failures).toEqual([]);
    expect(result.rekeyedFields).toBe(0);
    expect(result.erasedFields).toBe(1);
    expect(await createdBody(memoId)).toBe(PII_ERASED_SENTINEL);
  });

  test("ownerless, then owned, then ownerless again: stays tenant-keyed (the live path would keep the last owner)", async () => {
    const userX = generateId();
    const memoId = generateId();
    await appendPlain(memoId, "memo", "memo.created", { id: memoId, body: "Alice" });
    await appendPlain(
      memoId,
      "memo",
      "memo.updated",
      { changes: { ownerId: userX }, previous: { id: memoId } },
      1,
    );
    await appendPlain(
      memoId,
      "memo",
      "memo.updated",
      { changes: { ownerId: null }, previous: { id: memoId, ownerId: userX } },
      2,
    );
    await asRawClient(testDb.db).unsafe(
      `INSERT INTO "${memoTable.tableName}" (id, tenant_id, owner_id, body) VALUES ($1, $2, $3, $4)`,
      [memoId, TENANT, null, "projection-row-body"],
    );
    armKms();

    const result = await backfillEventPiiEncryption(testDb.db, registry, REKEY);

    expect(result.failures).toEqual([]);
    expect(result.rekeyedFields).toBe(0);
    expect(await createdBody(memoId)).toContain(`tenant:${TENANT}`);
  });

  test("follow-ups that omit the owner key (ownerless, owned, ownerless): the created value stays tenant-keyed", async () => {
    const userX = generateId();
    const memoId = generateId();
    await appendPlain(memoId, "memo", "memo.created", { id: memoId, body: "Alice" });
    await appendPlain(
      memoId,
      "memo",
      "memo.updated",
      { changes: { body: "Bob" }, previous: { id: memoId, body: "Alice" } },
      1,
    );
    await appendPlain(
      memoId,
      "memo",
      "memo.updated",
      { changes: { ownerId: userX }, previous: { id: memoId, body: "Bob" } },
      2,
    );
    await appendPlain(
      memoId,
      "memo",
      "memo.updated",
      { changes: { body: "Carol" }, previous: { id: memoId, body: "Bob", ownerId: userX } },
      3,
    );
    await asRawClient(testDb.db).unsafe(
      `INSERT INTO "${memoTable.tableName}" (id, tenant_id, owner_id, body) VALUES ($1, $2, $3, $4)`,
      [memoId, TENANT, null, "projection-row-body"],
    );
    armKms();

    const result = await backfillEventPiiEncryption(testDb.db, registry, REKEY);

    expect(result.failures).toEqual([]);
    expect(result.rekeyedFields).toBe(0);
    // Documented rebuild-vs-live deviation: a rebuild keeps the value tenant-keyed, the live path
    // would have re-keyed it under X when the owner arrived.
    expect(await createdBody(memoId)).toContain(`tenant:${TENANT}`);
  });
});

// Updates carry only the changed keys in previous, so an update of body alone names no owner.
// The owner of that value is the one the stream had then, not the owner the row has today.
describe("backfillEventPiiEncryption: owner of a slim update is the stream's owner at that event", () => {
  test("values written under owner A stay under A after the owner moved to B", async () => {
    const ownerA = generateId();
    const ownerB = generateId();
    const memoId = generateId();
    await appendPlain(memoId, "memo", "memo.created", { id: memoId, ownerId: ownerA, body: null });
    await appendPlain(
      memoId,
      "memo",
      "memo.updated",
      { changes: { body: "first note" }, previous: { body: null } },
      1,
    );
    await appendPlain(
      memoId,
      "memo",
      "memo.updated",
      { changes: { body: "second note" }, previous: { body: "first note" } },
      2,
    );
    await appendPlain(
      memoId,
      "memo",
      "memo.updated",
      { changes: { ownerId: ownerB }, previous: { ownerId: ownerA } },
      3,
    );
    await asRawClient(testDb.db).unsafe(
      `INSERT INTO "${memoTable.tableName}" (id, tenant_id, owner_id, body) VALUES ($1, $2, $3, $4)`,
      [memoId, TENANT, ownerB, "projection-row-body"],
    );
    armKms();

    const result = await backfillEventPiiEncryption(testDb.db, registry, {
      resolveOwnerFromProjection: true,
    });

    expect(result.failures).toEqual([]);
    expect(result.ownerFromProjection).toBe(0);
    const events = await loadAggregate(testDb.db, memoId, TENANT);
    const bodyOf = (version: number, section: "changes" | "previous"): string => {
      const payload = events.find((event) => event.version === version)?.payload as
        | Record<string, Record<string, unknown>>
        | undefined;
      return String(payload?.[section]?.["body"]);
    };
    const values = [bodyOf(2, "changes"), bodyOf(3, "changes"), bodyOf(3, "previous")];
    for (const value of values) {
      expect(value).toStartWith(`${PII_CIPHERTEXT_PREFIX}user:${ownerA}:`);
    }
    await kms.eraseKey({ kind: "user", userId: ownerB });
    expect(
      await decryptPiiValueForSubject(kms, values[0] ?? "", { requestId: "test" }, "body"),
    ).toBe("first note");
    await kms.eraseKey({ kind: "user", userId: ownerA });
    for (const value of values) {
      expect(await decryptPiiValueForSubject(kms, value, { requestId: "test" }, "body")).toBe(
        PII_ERASED_SENTINEL,
      );
    }
  });
});
