// Refs #2057 (partial) — hardDelete must crypto-shred the purged row's own
// KMS subject key AFTER the forget, mirroring run-forget-cleanup.ts:477-503's
// forget → eraseKey → nullBlindIndexesForSubject ordering. Only recordOwned
// and self-pii subjects belong to the row being deleted; a userOwned field's
// subject is the REFERENCED user, whose key may still protect that user's
// other live rows elsewhere — hardDelete of one row must never erase it.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  KeyErasedError,
} from "@cosmicdrift/kumiko-framework/crypto";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-framework/testing";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { createDataRetentionFeature, tenantRetentionOverrideEntity } from "../feature";
import { runRetentionCleanup } from "../run-retention-cleanup";

// Entity A: `personal: { of: "id" }` → recordOwned — the row IS its own
// subject. hardDelete must erase this key.
const recordOwnedEntity = createEntity({
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

const c9Feature = defineFeature("c9-retention-kms-fixtures", (r) => {
  r.entity("c9-record-owned", recordOwnedEntity);
  r.entity("c9-user-owned", userOwnedEntity);
});

let stack: TestStack;
let kms: InMemoryKmsAdapter;
let now: ReturnType<ReturnType<typeof getTemporal>["Now"]["instant"]>;
let pastIso: string;

beforeAll(async () => {
  stack = await setupTestStack({ features: [createDataRetentionFeature(), c9Feature] });
  for (const e of [tenantRetentionOverrideEntity, recordOwnedEntity, userOwnedEntity]) {
    await unsafeCreateEntityTable(stack.db, e);
  }
  now = getTemporal().Now.instant();
  pastIso = now.subtract({ hours: 60 * 24 }).toString(); // 60 days old, past the cutoff
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  for (const t of ["read_c9_record_owned", "read_c9_user_owned"]) {
    await asRawClient(stack.db).unsafe(`DELETE FROM ${t}`);
  }
  kms = new InMemoryKmsAdapter();
  configurePiiSubjectKms(kms);
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
});

// Ciphertext content is irrelevant to this test — it only proves which
// subject's key eraseKey was (not) called for, not the field encryption
// round-trip. The subject's key is pre-created here the same way the real
// write path creates it on first encrypt (getOrCreateDek), so eraseKey's
// effect is observable via getKey.
async function seedRecordOwned(tenantId: string, insertedAtIso: string): Promise<string> {
  const rows = (await asRawClient(stack.db).unsafe(
    `INSERT INTO read_c9_record_owned (tenant_id, note, inserted_at) VALUES ($1, $2, $3::timestamptz) RETURNING id::text AS id`,
    [tenantId, "pii:placeholder", insertedAtIso],
  )) as { id: string }[];
  const rowId = rows[0]?.id;
  if (!rowId) throw new Error("seedRecordOwned: insert returned no id");
  await kms.createKey({ kind: "record", entity: "c9-record-owned", id: rowId });
  return rowId;
}

async function seedUserOwned(
  tenantId: string,
  ownerUserId: string,
  insertedAtIso: string,
): Promise<string> {
  const rows = (await asRawClient(stack.db).unsafe(
    `INSERT INTO read_c9_user_owned (tenant_id, owner_user_id, note, inserted_at) VALUES ($1, $2, $3, $4::timestamptz) RETURNING id::text AS id`,
    [tenantId, ownerUserId, "pii:placeholder", insertedAtIso],
  )) as { id: string }[];
  const rowId = rows[0]?.id;
  if (!rowId) throw new Error("seedUserOwned: insert returned no id");
  await kms.createKey({ kind: "user", userId: ownerUserId });
  return rowId;
}

describe("runRetentionCleanup :: hardDelete crypto-shredding (Refs #2057)", () => {
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
});
