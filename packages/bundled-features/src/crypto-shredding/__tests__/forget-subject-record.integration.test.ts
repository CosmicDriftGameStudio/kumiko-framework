// crypto-shredding forget-subject over a "record" subject (kumiko-framework#2786):
//
//   - a row-scoped field (personal: { of: "id" } → recordOwned) shreds via
//     forget-subject with { subject: { kind: "record", entity, id } }
//   - the raw kumiko_events ciphertext stays permanently under the
//     record:<entity>:<id> prefix — decrypting it separately proves the
//     erase, not just the projection read path
//   - the record namespace never collides with a "user" subject that
//     happens to share the same uuid

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configurePiiSubjectKms,
  decryptPiiFieldValues,
  InMemoryKmsAdapter,
  isPiiCiphertext,
  PII_CIPHERTEXT_PREFIX,
  PII_ERASED_SENTINEL,
} from "@cosmicdrift/kumiko-framework/crypto";
import {
  buildEntityTable,
  createEventStoreExecutor,
  createTenantDb,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createTextField,
  defineFeature,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable, eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetPiiSubjectKmsForTests, resetTestTables } from "@cosmicdrift/kumiko-framework/testing";
import { createConfigFeature } from "../../config";
import { createTenantFeature } from "../../tenant";
import { tenantMembershipsTable } from "../../tenant/membership-table";
import { RECORD_ENTITY_NOT_REGISTERED, TARGET_RECORD_NOT_ADMIN_TENANT } from "../constants";
import { createCryptoShreddingFeature } from "../feature";

const FORGET = "crypto-shredding:write:forget-subject";
const RECORD_PROBE_ENTITY_NAME = "recordProbe";
const REASON = "authority request #2786 (Art. 17 row-subject)";

const recordProbeEntity = createEntity({
  table: "read_forget_subject_record_probe",
  fields: {
    body: createTextField({
      required: true,
      maxLength: 200,
      personal: { of: "id" },
      find: "none",
    }),
  },
});
const recordProbeTable = buildEntityTable("forgetSubjectRecordProbe", recordProbeEntity);
const recordProbeFeature = defineFeature("forget-subject-record-probe", (r) => {
  r.entity(RECORD_PROBE_ENTITY_NAME, recordProbeEntity);
});

function recordProbeExecutor() {
  return createEventStoreExecutor(recordProbeTable, recordProbeEntity, {
    entityName: RECORD_PROBE_ENTITY_NAME,
  });
}

const TENANT: TenantId = testTenantId(21);

const dpoUser = {
  id: "cccccccc-cccc-4ccc-8ccc-000000000001",
  tenantId: TENANT,
  roles: ["DataProtectionOfficer"],
};

let stack: TestStack;
let kms: InMemoryKmsAdapter;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createCryptoShreddingFeature(), recordProbeFeature],
  });
  await unsafeCreateEntityTable(stack.db, recordProbeEntity, RECORD_PROBE_ENTITY_NAME);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [recordProbeTable, eventsTable]);
  kms = new InMemoryKmsAdapter();
  configurePiiSubjectKms(kms);
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
});

describe("crypto-shredding :: forget-subject (record subject, #2786)", () => {
  test("erases the row's ciphertext under the record namespace, proven via decrypt; a same-uuid user-forget never touches it", async () => {
    const tenantDb = createTenantDb(stack.db, TENANT, "system");
    const plaintext = "confidential support note";
    const created = await recordProbeExecutor().create({ body: plaintext }, dpoUser, tenantDb);
    if (!created.isSuccess) throw new Error("create failed");
    const rowId = String(created.data.id);

    const beforeShred = await recordProbeExecutor().detail({ id: rowId }, dpoUser, tenantDb);
    expect(beforeShred?.["body"]).toBe(plaintext);

    // Namespace separation, checked BEFORE the record subject is touched: a
    // user-forget for the row's own uuid must leave the record row readable
    // — record:<entity>:<id> and user:<id> are different DEKs even when the
    // uuid is identical.
    await stack.http.writeOk(
      FORGET,
      { subject: { kind: "user", userId: rowId }, reason: REASON },
      dpoUser,
    );
    const afterBystanderForget = await recordProbeExecutor().detail(
      { id: rowId },
      dpoUser,
      tenantDb,
    );
    expect(afterBystanderForget?.["body"]).toBe(plaintext);

    const result = await stack.http.writeOk<{ subjectKey: string }>(
      FORGET,
      {
        subject: { kind: "record", entity: RECORD_PROBE_ENTITY_NAME, id: rowId },
        reason: REASON,
      },
      dpoUser,
    );
    expect(result.subjectKey).toBe(`record:${RECORD_PROBE_ENTITY_NAME}:${rowId}`);

    const afterShred = await recordProbeExecutor().detail({ id: rowId }, dpoUser, tenantDb);
    expect(afterShred?.["body"]).toBe(PII_ERASED_SENTINEL);

    const createdEvents = (await selectMany(stack.db, eventsTable, {
      aggregateId: rowId,
      type: `${RECORD_PROBE_ENTITY_NAME}.created`,
    })) as Array<{ payload: Record<string, unknown> }>;
    expect(createdEvents).toHaveLength(1);
    const rawBody = createdEvents[0]?.payload["body"];
    expect(typeof rawBody).toBe("string");
    expect(isPiiCiphertext(rawBody)).toBe(true);
    expect(String(rawBody)).toStartWith(
      `${PII_CIPHERTEXT_PREFIX}record:${RECORD_PROBE_ENTITY_NAME}:${rowId}:`,
    );
    expect(String(rawBody)).not.toContain(plaintext);

    const decrypted = await decryptPiiFieldValues({ body: rawBody }, ["body"], kms, {
      requestId: "test",
    });
    expect(decrypted["body"]).toBe(PII_ERASED_SENTINEL);
  });

  // Empirical: update()'s previous-row re-encrypt (encryptForStorage(previous))
  // sees the erased sentinel and passes it through unchanged (pii-field-
  // encryption.ts's isPiiCiphertext/PII_ERASED_SENTINEL short-circuit) — but
  // the NEW value in `changes` is real plaintext, so it still needs a DEK.
  // getOrCreateDek's getKey call on a tombstoned subject throws KeyErasedError,
  // which propagates out of update() uncaught (only version-conflict errors
  // are caught there). Not record-specific: the same getOrCreateDek path runs
  // for a user/tenant PII field after that subject is forgotten.
  test("update on an already-shredded row rejects instead of writing a fresh plaintext value", async () => {
    const tenantDb = createTenantDb(stack.db, TENANT, "system");
    const created = await recordProbeExecutor().create(
      { body: "pre-shred content" },
      dpoUser,
      tenantDb,
    );
    if (!created.isSuccess) throw new Error("create failed");
    const rowId = String(created.data.id);

    await stack.http.writeOk(
      FORGET,
      { subject: { kind: "record", entity: RECORD_PROBE_ENTITY_NAME, id: rowId }, reason: REASON },
      dpoUser,
    );

    await expect(
      recordProbeExecutor().update(
        { id: rowId, changes: { body: "post-shred content" } },
        dpoUser,
        tenantDb,
        { skipOptimisticLock: true },
      ),
    ).rejects.toThrow(`Subject key erased: record:${RECORD_PROBE_ENTITY_NAME}:${rowId}`);
  });
});

// mh#349 / #2786: resolveTenantScopeDenial's record branch has its own
// `!features.has("tenant")` fail-open — a denial test against the top-of-file
// stack (crypto-shredding only) would pass without proving anything, since
// the tenant gate never even runs there. This describe mounts a separate
// stack with the tenant feature actually present so the two denial branches
// (RECORD_ENTITY_NOT_REGISTERED, TARGET_RECORD_NOT_ADMIN_TENANT) get real
// coverage.
describe("crypto-shredding :: forget-subject (record subject) tenant gate, #2786", () => {
  let gateStack: TestStack;
  let gateKms: InMemoryKmsAdapter;

  const GATE_TENANT_A: TenantId = testTenantId(22);
  const GATE_TENANT_B: TenantId = testTenantId(23);

  const dpoTenantA = {
    id: "cccccccc-cccc-4ccc-8ccc-000000000002",
    tenantId: GATE_TENANT_A,
    roles: ["DataProtectionOfficer"],
  };
  const dpoTenantB = {
    id: "cccccccc-cccc-4ccc-8ccc-000000000003",
    tenantId: GATE_TENANT_B,
    roles: ["DataProtectionOfficer"],
  };

  beforeAll(async () => {
    gateStack = await setupTestStack({
      features: [
        createCryptoShreddingFeature(),
        createConfigFeature(),
        createTenantFeature(),
        recordProbeFeature,
      ],
    });
    await unsafeCreateEntityTable(gateStack.db, recordProbeEntity, RECORD_PROBE_ENTITY_NAME);
    await unsafePushTables(gateStack.db, { tenantMembershipsTable });
    await createEventsTable(gateStack.db);
  });

  afterAll(async () => {
    await gateStack.cleanup();
  });

  beforeEach(async () => {
    await resetTestTables(gateStack.db, [recordProbeTable, eventsTable]);
    gateKms = new InMemoryKmsAdapter();
    configurePiiSubjectKms(gateKms);
  });

  afterEach(() => {
    resetPiiSubjectKmsForTests();
  });

  test("DPO from another tenant cannot forget a record subject owned by a foreign tenant → denied, key survives", async () => {
    const tenantADb = createTenantDb(gateStack.db, GATE_TENANT_A, "system");
    const plaintext = "tenant A confidential note";
    const created = await recordProbeExecutor().create({ body: plaintext }, dpoTenantA, tenantADb);
    if (!created.isSuccess) throw new Error("create failed");
    const rowId = String(created.data.id);

    const err = await gateStack.http.writeErr(
      FORGET,
      {
        subject: { kind: "record", entity: RECORD_PROBE_ENTITY_NAME, id: rowId },
        reason: REASON,
      },
      dpoTenantB,
    );
    expect(err.httpStatus).toBe(403);
    expect((err.details as { reason?: string } | undefined)?.reason).toBe(
      TARGET_RECORD_NOT_ADMIN_TENANT,
    );

    const stillReadable = await recordProbeExecutor().detail({ id: rowId }, dpoTenantA, tenantADb);
    expect(stillReadable?.["body"]).toBe(plaintext);
  });

  test("record subject naming an unregistered entity is denied, not resolved into raw SQL", async () => {
    const err = await gateStack.http.writeErr(
      FORGET,
      {
        subject: { kind: "record", entity: "notARegisteredEntity", id: crypto.randomUUID() },
        reason: REASON,
      },
      dpoTenantA,
    );
    expect(err.httpStatus).toBe(403);
    expect((err.details as { reason?: string } | undefined)?.reason).toBe(
      RECORD_ENTITY_NOT_REGISTERED,
    );
  });
});
