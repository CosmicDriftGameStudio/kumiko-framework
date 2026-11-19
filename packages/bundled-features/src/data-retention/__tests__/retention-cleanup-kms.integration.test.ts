// hardDelete must crypto-shred the purged row's own
// KMS subject key AFTER the forget, mirroring run-forget-cleanup.ts:477-503's
// forget → eraseKey → nullBlindIndexesForSubject ordering. Only recordOwned
// and self-pii subjects belong to the row being deleted; a userOwned field's
// subject is the REFERENCED user, whose key may still protect that user's
// other live rows elsewhere — hardDelete of one row must never erase it.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  KeyErasedError,
} from "@cosmicdrift/kumiko-framework/crypto";
import {
  asRawClient,
  buildEntityTable,
  createEventStoreExecutor,
  selectMany,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createSystemUser,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  eventsTable,
  runSeedWritesAt,
  SEED_MODE_ENV,
} from "@cosmicdrift/kumiko-framework/event-store";
import { createTenantDb } from "@cosmicdrift/kumiko-framework/internal/row-level-security";
import { testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import {
  resetPiiSubjectKmsForTests,
  seedRowViaEventStore,
  withEnv,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { createDataRetentionFeature, tenantRetentionOverrideEntity } from "../feature.ts";
import { runRetentionCleanup } from "../run-retention-cleanup.ts";

// Entity A: `personal: { of: "id" }` → recordOwned — the row IS its own
// subject. hardDelete must erase this key.
const recordOwnedEntity = createEntity({
  name: "c9-record-owned",
  table: "read_c9_record_owned",
  fields: {
    note: createTextField({ required: true, personal: { of: "id" }, find: "none" }),
  },
  retention: { keepFor: "30d", strategy: "hardDelete" },
});

// Entity B: `personal: { of: "ownerUserId" }` → userOwned — the subject is
// the REFERENCED user, not this row. hardDelete of this row must NEVER
// erase the owner's key (they may own other, still-live rows).
const userOwnedEntity = createEntity({
  name: "c9-user-owned",
  table: "read_c9_user_owned",
  fields: {
    ownerUserId: createTextField({
      required: true,
      personal: false,
      reason: "technical_reference",
    }),
    note: createTextField({ required: true, personal: { of: "ownerUserId" }, find: "none" }),
  },
  retention: { keepFor: "30d", strategy: "hardDelete" },
});

// Entity C: whenAbsent "self" → an ownerless row is keyed on itself (erased by
// hardDelete), a row with an owner sits under the owner's key (left alone).
const selfFallbackEntity = createEntity({
  name: "c9-self-fallback",
  table: "read_c9_self_fallback",
  fields: {
    ownerUserId: createTextField({ personal: "ref" }),
    note: createTextField({
      personal: { of: "ownerUserId", whenAbsent: "self" },
      find: "none",
    }),
  },
  retention: { keepFor: "30d", strategy: "hardDelete" },
});

// Entity D: anonymize strategy over an encrypted PII field. The stored value is ciphertext, so the
// "already anonymized" diff must compare the decrypted value.
const anonPiiEntity = createEntity({
  name: "c9-anon-pii",
  table: "read_c9_anon_pii",
  fields: {
    note: {
      ...createTextField({ required: true, personal: { of: "id" }, find: "none" }),
      anonymize: () => "[ANONYMIZED]",
    },
  },
  retention: { keepFor: "30d", strategy: "anonymize" },
});
const anonPiiTable = buildEntityTable(anonPiiEntity);
const anonPiiExecutor = createEventStoreExecutor(anonPiiTable, anonPiiEntity, {
  entityName: "c9-anon-pii",
});

const c9Feature = defineFeature("c9-retention-kms-fixtures", (r) => {
  r.entity(anonPiiEntity);
  r.entity(selfFallbackEntity);
  r.entity(recordOwnedEntity);
  r.entity(userOwnedEntity);
});

let stack: TestStack;
let kms: InMemoryKmsAdapter;
let now: ReturnType<ReturnType<typeof getTemporal>["Now"]["instant"]>;
let pastIso: string;

beforeAll(async () => {
  stack = await setupTestStack({ features: [createDataRetentionFeature(), c9Feature] });
  for (const e of [
    tenantRetentionOverrideEntity,
    recordOwnedEntity,
    userOwnedEntity,
    selfFallbackEntity,
    anonPiiEntity,
  ]) {
    await unsafeCreateEntityTable(stack.db, e);
  }
  now = getTemporal().Now.instant();
  pastIso = now.subtract({ hours: 60 * 24 }).toString(); // 60 days old, past the cutoff
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetEventStore(stack, [
    "read_c9_record_owned",
    "read_c9_user_owned",
    "read_c9_self_fallback",
    "read_c9_anon_pii",
  ]);
  kms = new InMemoryKmsAdapter();
  configurePiiSubjectKms(kms);
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
});

// The create event is back-dated so the row lands past the cutoff; encrypting its note creates the
// subject key (getOrCreateDek), so eraseKey's effect is observable via getKey.
async function seedExpiredRow(
  entity: Parameters<typeof buildEntityTable>[0],
  values: Readonly<Record<string, unknown>>,
  insertedAtIso: string,
): Promise<string> {
  const id = crypto.randomUUID();
  await withEnv({ [SEED_MODE_ENV]: "1" }, () =>
    runSeedWritesAt(getTemporal().Instant.from(insertedAtIso), () =>
      seedRowViaEventStore(stack.db, buildEntityTable(entity), { id, ...values }),
    ),
  );
  return id;
}

function seedRecordOwned(tenantId: string, insertedAtIso: string): Promise<string> {
  return seedExpiredRow(recordOwnedEntity, { tenantId, note: "pii" }, insertedAtIso);
}

function seedUserOwned(
  tenantId: string,
  ownerUserId: string,
  insertedAtIso: string,
): Promise<string> {
  return seedExpiredRow(userOwnedEntity, { tenantId, ownerUserId, note: "pii" }, insertedAtIso);
}

describe("runRetentionCleanup :: anonymize over encrypted PII", () => {
  const tenantId = testTenantId(9);

  async function createEncryptedRow(): Promise<string> {
    const result = await anonPiiExecutor.create(
      { note: "secret" },
      createSystemUser(tenantId),
      createTenantDb({
        db: stack.db,
        tenantId,
        mode: "system",
        reason: "test writes an encrypted row of an explicit tenant",
      }),
    );
    if (!result.isSuccess) throw new Error(`create failed: ${result.error.code}`);
    return String(result.data["id"]);
  }

  async function anonymizeEventCount(): Promise<number> {
    const events = await selectMany(stack.db, eventsTable, { aggregateType: "c9-anon-pii" });
    return events.length;
  }

  // The rows are fresh, so the cleanup runs 60 days ahead to put them past the cutoff.
  const runCleanup = () =>
    runRetentionCleanup({
      db: stack.db,
      registry: stack.registry,
      tenantId,
      preloadedTenantPreset: null,
      now: now.add({ hours: 60 * 24 }),
    });

  test("a second run appends no anonymize event for an already anonymized encrypted field", async () => {
    await createEncryptedRow();

    expect((await runCleanup()).anonymized).toBe(1);
    const eventsAfterFirst = await anonymizeEventCount();
    expect((await runCleanup()).anonymized).toBe(0);
    expect(await anonymizeEventCount()).toBe(eventsAfterFirst);
  });

  test("a row whose subject key was erased counts as anonymized and appends no event", async () => {
    const rowId = await createEncryptedRow();
    await kms.eraseKey({ kind: "record", entity: "c9-anon-pii", id: rowId });
    const eventsBefore = await anonymizeEventCount();

    expect((await runCleanup()).anonymized).toBe(0);
    expect(await anonymizeEventCount()).toBe(eventsBefore);
  });
});

describe("runRetentionCleanup :: hardDelete crypto-shredding", () => {
  test("erases a recordOwned row's own key, leaves a userOwned row's owner key untouched", async () => {
    const tenantId = testTenantId(9);
    const ownerUserId = crypto.randomUUID();
    const recordRowId = await seedRecordOwned(tenantId, pastIso);
    const userRowId = await seedUserOwned(tenantId, ownerUserId, pastIso);

    // Sanity: both keys exist and are readable before cleanup runs.
    await expect(
      kms.getKey({ kind: "record", entity: "c9-record-owned", id: recordRowId }),
    ).resolves.toBeInstanceOf(Buffer);
    await expect(kms.getKey({ kind: "user", userId: ownerUserId })).resolves.toBeInstanceOf(Buffer);

    const result = await runRetentionCleanup({
      db: stack.db,
      registry: stack.registry,
      tenantId,
      preloadedTenantPreset: null,
      now,
    });

    expect(result.hardDeleted).toBe(2);

    const recordRows = await asRawClient(stack.db).unsafe(
      `SELECT id FROM read_c9_record_owned WHERE tenant_id = $1`,
      [tenantId],
    );
    expect(recordRows).toHaveLength(0);
    await expect(
      kms.getKey({ kind: "record", entity: "c9-record-owned", id: recordRowId }),
    ).rejects.toThrow(KeyErasedError);

    const userRows = await asRawClient(stack.db).unsafe(
      `SELECT id FROM read_c9_user_owned WHERE tenant_id = $1`,
      [tenantId],
    );
    expect(userRows).toHaveLength(0);
    expect(userRowId).toBeTruthy();
    // The owner's key must survive — it is not this row's own subject.
    await expect(kms.getKey({ kind: "user", userId: ownerUserId })).resolves.toBeInstanceOf(Buffer);
  });

  test("whenAbsent self: erases the record key of an ownerless row, leaves the owner key of an owned row", async () => {
    const tenantId = testTenantId(9);
    const ownerUserId = crypto.randomUUID();
    const insert = (owner: string | null): Promise<string> =>
      seedExpiredRow(selfFallbackEntity, { tenantId, ownerUserId: owner, note: "pii" }, pastIso);
    const ownerlessId = await insert(null);
    await insert(ownerUserId);

    const result = await runRetentionCleanup({
      db: stack.db,
      registry: stack.registry,
      tenantId,
      preloadedTenantPreset: null,
      now,
    });

    expect(result.hardDeleted).toBe(2);
    await expect(
      kms.getKey({ kind: "record", entity: "c9-self-fallback", id: ownerlessId }),
    ).rejects.toThrow(KeyErasedError);
    await expect(kms.getKey({ kind: "user", userId: ownerUserId })).resolves.toBeInstanceOf(Buffer);
  });
});
