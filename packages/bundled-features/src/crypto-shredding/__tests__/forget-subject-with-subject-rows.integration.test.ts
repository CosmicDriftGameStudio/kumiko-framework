// forget-subject forgets the rows of entities that declare forgetWithSubject, through the
// executor, in the same transaction as the rest of the forget; the key goes after commit.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import {
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  type SubjectId,
} from "@cosmicdrift/kumiko-framework/crypto";
import {
  buildEntityTable,
  createEventStoreExecutor,
  selectMany,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createTextField,
  defineFeature,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  createTenantDb,
  resetPiiSubjectKmsForTests,
  resetTestTables,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  drainEventConsumers,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  createDataRetentionFeature,
  tenantRetentionOverrideEntity,
  tenantRetentionOverrideTable,
} from "../../data-retention/index.ts";
import { SUBJECT_FORGOTTEN_EVENT_NAME, SUBJECT_KEY_ERASER_CONSUMER_NAME } from "../constants.ts";
import { createCryptoShreddingFeature } from "../feature.ts";

const FORGET = "crypto-shredding:write:forget-subject";
const REASON = "authority request #2790 (Art. 17 row-bound subjects)";

const TENANT_A: TenantId = testTenantId(41);
const TENANT_B: TenantId = testTenantId(42);

const dpoUser = {
  id: "dddddddd-dddd-4ddd-8ddd-000000000001",
  tenantId: TENANT_A,
  roles: ["DataProtectionOfficer"],
};

const subscriberEntity = createEntity({
  name: "forgetRowsSubscriber",
  table: "read_forget_rows_subscriber",
  forgetWithSubject: true,
  fields: {
    email: createTextField({ personal: "self", find: "exact", format: "email" }),
  },
});
const supportNoteEntity = createEntity({
  name: "forgetRowsSupportNote",
  table: "read_forget_rows_support_note",
  forgetWithSubject: true,
  fields: {
    body: createTextField({ personal: { of: "id" }, find: "none" }),
  },
});
const plainNoteEntity = createEntity({
  name: "forgetRowsPlainNote",
  table: "read_forget_rows_plain_note",
  fields: {
    body: createTextField({ personal: { of: "id" }, find: "none" }),
  },
});

const subscriberTable = buildEntityTable(subscriberEntity);
const supportNoteTable = buildEntityTable(supportNoteEntity);
const plainNoteTable = buildEntityTable(plainNoteEntity);

const probeFeature = defineFeature("forget-rows-probe", (r) => {
  const noCrudVerbs = { create: false, delete: false, detail: false, list: false } as const;
  const write = { access: { roles: ["DataProtectionOfficer"] } };
  r.crud({ ...subscriberEntity, name: "subscriber" }, { verbs: noCrudVerbs, write });
  r.crud({ ...supportNoteEntity, name: "support-note" }, { verbs: noCrudVerbs, write });
  r.crud({ ...plainNoteEntity, name: "plain-note" }, { verbs: noCrudVerbs, write });
});

function tenantDbOf(stack: TestStack, tenantId: TenantId) {
  return createTenantDb({
    db: stack.db,
    tenantId,
    mode: "system",
    reason: "test seeds and inspects subject rows across tenants around forget",
  });
}

async function seedSubscriber(stack: TestStack, tenantId: TenantId = TENANT_A): Promise<string> {
  const created = await createEventStoreExecutor(subscriberTable, subscriberEntity, {
    entityName: "subscriber",
  }).create({ email: "reader@example.com" }, { ...dpoUser, tenantId }, tenantDbOf(stack, tenantId));
  if (!created.isSuccess) throw new Error("subscriber create failed");
  return String(created.data.id);
}

async function seedNote(
  stack: TestStack,
  entityName: "support-note" | "plain-note",
  tenantId: TenantId = TENANT_A,
): Promise<string> {
  const isSupport = entityName === "support-note";
  const created = await createEventStoreExecutor(
    isSupport ? supportNoteTable : plainNoteTable,
    isSupport ? supportNoteEntity : plainNoteEntity,
    { entityName },
  ).create({ body: "confidential note" }, { ...dpoUser, tenantId }, tenantDbOf(stack, tenantId));
  if (!created.isSuccess) throw new Error("note create failed");
  return String(created.data.id);
}

async function rowCount(
  stack: TestStack,
  table: typeof subscriberTable | typeof supportNoteTable | typeof plainNoteTable,
  id: string,
  tenantId: TenantId = TENANT_A,
): Promise<number> {
  return (await selectMany(tenantDbOf(stack, tenantId), table, { id })).length;
}

async function forgottenEventsOf(
  stack: TestStack,
  subjectKey: string,
): Promise<Array<{ payload: Record<string, unknown> }>> {
  return (
    (await selectMany(stack.db, eventsTable, {
      type: SUBJECT_FORGOTTEN_EVENT_NAME,
    })) as Array<{ payload: Record<string, unknown> }>
  ).filter((e) => e.payload["subjectKey"] === subjectKey);
}

async function expectKeyErased(stack: TestStack, kms: InMemoryKmsAdapter, subject: SubjectId) {
  await drainEventConsumers(stack, [SUBJECT_KEY_ERASER_CONSUMER_NAME]);
  await expect(kms.getKey(subject)).rejects.toThrow("Subject key erased");
}

describe("crypto-shredding :: forget-subject forgets forgetWithSubject rows", () => {
  let stack: TestStack;
  let kms: InMemoryKmsAdapter;

  beforeAll(async () => {
    stack = await setupTestStack({ features: [createCryptoShreddingFeature(), probeFeature] });
    await unsafeCreateEntityTable(stack.db, subscriberEntity, "subscriber");
    await unsafeCreateEntityTable(stack.db, supportNoteEntity, "support-note");
    await unsafeCreateEntityTable(stack.db, plainNoteEntity, "plain-note");
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  beforeEach(async () => {
    await resetTestTables(stack.db, [
      subscriberTable,
      supportNoteTable,
      plainNoteTable,
      eventsTable,
    ]);
    kms = new InMemoryKmsAdapter();
    configurePiiSubjectKms(kms);
  });

  afterEach(() => {
    resetPiiSubjectKmsForTests();
  });

  test("a user subject forgets the row whose id is the user id, then its key is erased", async () => {
    const id = await seedSubscriber(stack);
    expect(await rowCount(stack, subscriberTable, id)).toBe(1);

    await stack.http.writeOk(
      FORGET,
      { subject: { kind: "user", userId: id }, reason: REASON },
      dpoUser,
    );

    expect(await rowCount(stack, subscriberTable, id)).toBe(0);
    await expectKeyErased(stack, kms, { kind: "user", userId: id });

    const events = await forgottenEventsOf(stack, `user:${id}`);
    expect(events).toHaveLength(1);
    const payload = events[0]?.payload ?? {};
    expect(payload).toMatchObject({
      subjectKey: `user:${id}`,
      reason: REASON,
      forgottenBy: dpoUser.id,
    });
    expect(Object.keys(payload).sort()).toEqual(["forgottenBy", "reason", "subjectKey"]);
  });

  test("a record subject forgets the row of its own forgetWithSubject entity", async () => {
    const id = await seedNote(stack, "support-note");

    await stack.http.writeOk(
      FORGET,
      { subject: { kind: "record", entity: "support-note", id }, reason: REASON },
      dpoUser,
    );

    expect(await rowCount(stack, supportNoteTable, id)).toBe(0);
    await expectKeyErased(stack, kms, { kind: "record", entity: "support-note", id });
  });

  test("an entity without forgetWithSubject keeps its row, the key is still erased", async () => {
    const id = await seedNote(stack, "plain-note");

    await stack.http.writeOk(
      FORGET,
      { subject: { kind: "record", entity: "plain-note", id }, reason: REASON },
      dpoUser,
    );

    expect(await rowCount(stack, plainNoteTable, id)).toBe(1);
    await expectKeyErased(stack, kms, { kind: "record", entity: "plain-note", id });
  });

  test("a SystemAdmin forgets a record whose row lives in another tenant", async () => {
    const id = await seedNote(stack, "support-note", TENANT_B);
    expect(await rowCount(stack, supportNoteTable, id, TENANT_B)).toBe(1);

    await stack.http.writeOk(
      FORGET,
      { subject: { kind: "record", entity: "support-note", id }, reason: REASON },
      TestUsers.systemAdmin,
    );

    expect(await rowCount(stack, supportNoteTable, id, TENANT_B)).toBe(0);
  });
});

describe("crypto-shredding :: forget-subject keeps a row under tenant blockDelete", () => {
  let stack: TestStack;
  let kms: InMemoryKmsAdapter;

  beforeAll(async () => {
    stack = await setupTestStack({
      features: [createCryptoShreddingFeature(), createDataRetentionFeature(), probeFeature],
    });
    await unsafeCreateEntityTable(stack.db, subscriberEntity, "subscriber");
    await unsafeCreateEntityTable(stack.db, supportNoteEntity, "support-note");
    await unsafeCreateEntityTable(stack.db, plainNoteEntity, "plain-note");
    await unsafeCreateEntityTable(stack.db, tenantRetentionOverrideEntity);
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  beforeEach(async () => {
    await resetTestTables(stack.db, [
      subscriberTable,
      supportNoteTable,
      plainNoteTable,
      tenantRetentionOverrideTable,
      eventsTable,
    ]);
    kms = new InMemoryKmsAdapter();
    configurePiiSubjectKms(kms);
  });

  afterEach(() => {
    resetPiiSubjectKmsForTests();
  });

  test("a user forget leaves the subscriber row standing and erases the key after the drain", async () => {
    const id = await seedSubscriber(stack);
    const overrideCreated = await createEventStoreExecutor(
      tenantRetentionOverrideTable,
      tenantRetentionOverrideEntity,
      { entityName: "tenant-retention-override" },
    ).create(
      {
        entityName: "subscriber",
        config: JSON.stringify({ keepFor: "10y", strategy: "blockDelete" }),
        reason: "legal hold",
        tenantId: TENANT_A,
      },
      { ...dpoUser, roles: ["SystemAdmin"] },
      tenantDbOf(stack, TENANT_A),
    );
    if (!overrideCreated.isSuccess) throw new Error("override create failed");

    await stack.http.writeOk(
      FORGET,
      { subject: { kind: "user", userId: id }, reason: REASON },
      dpoUser,
    );

    expect(await rowCount(stack, subscriberTable, id)).toBe(1);
    await expectKeyErased(stack, kms, { kind: "user", userId: id });
  });
});
