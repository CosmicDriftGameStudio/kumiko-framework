// personal: { of, whenAbsent: "self" }: a record-forget shreds the
// fields of an ownerless row (value + blind index) while owner-keyed values of
// other rows and tenant-keyed fields of the same row stay readable.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  configureBlindIndexKey,
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  KeyErasedError,
  PII_ERASED_SENTINEL,
  subjectIdToKey,
} from "@cosmicdrift/kumiko-framework/crypto";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  resetBlindIndexKeyForTests,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  drainEventConsumers,
  resetEventStore,
  setupTestStack,
  type TestStack,
} from "@cosmicdrift/kumiko-testing/stack";
import { SUBJECT_FORGOTTEN_EVENT_NAME, SUBJECT_KEY_ERASER_CONSUMER_NAME } from "../constants.ts";
import { createCryptoShreddingFeature } from "../feature.ts";
import { subjectForgottenSchema } from "../handlers/forget-subject.write.ts";

const FORGET = "crypto-shredding:write:forget-subject";
const CREATE = "forget-self-probe:write:slip:create";
const UPDATE = "forget-self-probe:write:slip:update";
const LIST = "forget-self-probe:query:slip:list";
const DETAIL = "forget-self-probe:query:slip:detail";
const REASON = "authority request #3811 (Art. 17 ownerless row)";
const OWNER = "dddddddd-dddd-4ddd-8ddd-000000000001";

const slipEntity = createEntity({
  name: "slip",
  table: "read_forget_self_probe_slips",
  fields: {
    ownerId: createTextField({ personal: "ref" }),
    name: createTextField({ personal: { of: "ownerId", whenAbsent: "self" }, find: "none" }),
    code: createTextField({ personal: { of: "ownerId", whenAbsent: "self" }, find: "exact" }),
    note: createTextField({ personal: { of: "ownerId", whenAbsent: "tenant" }, find: "none" }),
  },
});

const probeFeature = defineFeature("forget-self-probe", (r) => {
  r.entity(slipEntity);
  r.crud(slipEntity, {
    write: { access: { roles: ["DataProtectionOfficer"] } },
    read: { access: { roles: ["DataProtectionOfficer"] } },
  });
});

const dpoUser = {
  id: "cccccccc-cccc-4ccc-8ccc-000000000031",
  tenantId: testTenantId(31),
  roles: ["DataProtectionOfficer"],
};

const dpoUserOtherTenant = {
  id: "cccccccc-cccc-4ccc-8ccc-000000000032",
  tenantId: testTenantId(32),
  roles: ["DataProtectionOfficer"],
};

let stack: TestStack;
let kms: InMemoryKmsAdapter;

beforeAll(async () => {
  stack = await setupTestStack({ features: [createCryptoShreddingFeature(), probeFeature] });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetEventStore(stack, ["read_forget_self_probe_slips"]);
  kms = new InMemoryKmsAdapter();
  configurePiiSubjectKms(kms);
  configureBlindIndexKey(Buffer.alloc(32, 7).toString("base64"));
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
  resetBlindIndexKeyForTests();
});

async function createSlip(fields: Record<string, unknown>): Promise<string> {
  const { id } = await stack.http.writeOk<{ id: string }>(CREATE, fields, dpoUser);
  return id;
}

async function detail(id: string): Promise<Record<string, unknown>> {
  return stack.http.queryOk<Record<string, unknown>>(DETAIL, { id }, dpoUser);
}

// Equality on a lookupable field matches through the blind index; once the index is
// nulled, the sentinel value no longer matches either.
async function idsWithCode(code: string): Promise<readonly unknown[]> {
  const page = await stack.http.queryOk<{ rows: readonly { id: unknown }[] }>(
    LIST,
    { filter: { field: "code", op: "eq", value: code } },
    dpoUser,
  );
  return page.rows.map((row) => row.id);
}

describe("crypto-shredding :: forgetting a record's self fields whenAbsent", () => {
  test("shreds the ownerless row's self fields and blind index; tenant-keyed and owner-keyed values stay readable", async () => {
    const ownerless = await createSlip({ name: "gone name", code: "gone-code", note: "kept note" });
    const owned = await createSlip({ ownerId: OWNER, name: "owned name", code: "owned-code" });
    expect(await idsWithCode("gone-code")).toEqual([ownerless]);

    await stack.http.writeOk(
      FORGET,
      { subject: { kind: "record", entity: "slip", id: ownerless }, reason: REASON },
      dpoUser,
    );

    await drainEventConsumers(stack, [SUBJECT_KEY_ERASER_CONSUMER_NAME]);
    const erased = await detail(ownerless);
    expect(erased["name"]).toBe(PII_ERASED_SENTINEL);
    expect(erased["code"]).toBe(PII_ERASED_SENTINEL);
    expect(erased["note"]).toBe("kept note");
    expect(await idsWithCode("gone-code")).toEqual([]);

    const untouched = await detail(owned);
    expect(untouched["name"]).toBe("owned name");
    expect(untouched["code"]).toBe("owned-code");
    expect(await idsWithCode("owned-code")).toEqual([owned]);
  });

  test("forgetting the owner erases the record key that sealed the row's ownerless phase", async () => {
    const id = await createSlip({ name: "early name", code: "early-code" });
    const control = await createSlip({ name: "never owned" });
    await stack.http.writeOk(UPDATE, { id, version: 1, changes: { ownerId: OWNER } }, dpoUser);
    const recordSubject = { kind: "record" as const, entity: "slip", id };

    const events = await selectMany<{ payload: unknown }>(stack.db, eventsTable, {
      aggregateId: id,
    });
    expect(JSON.stringify(events.map((e) => e.payload))).toContain(
      `:${subjectIdToKey(recordSubject)}:`,
    );
    await kms.getKey(recordSubject);

    await stack.http.writeOk(
      FORGET,
      { subject: { kind: "user", userId: OWNER }, reason: REASON },
      dpoUser,
    );
    await drainEventConsumers(stack, [SUBJECT_KEY_ERASER_CONSUMER_NAME]);

    await expect(kms.getKey(recordSubject)).rejects.toBeInstanceOf(KeyErasedError);
    expect((await detail(control))["name"]).toBe("never owned");
  });

  test("forgetting the owner announces each record key erase in the row's own tenant", async () => {
    const { id } = await stack.http.writeOk<{ id: string }>(
      CREATE,
      { name: "other early" },
      dpoUserOtherTenant,
    );
    await stack.http.writeOk(
      UPDATE,
      { id, version: 1, changes: { ownerId: OWNER } },
      dpoUserOtherTenant,
    );
    const recordSubject = { kind: "record" as const, entity: "slip", id };
    await kms.getKey(recordSubject);

    await stack.http.writeOk(
      FORGET,
      { subject: { kind: "user", userId: OWNER }, reason: REASON },
      dpoUser,
    );
    await drainEventConsumers(stack, [SUBJECT_KEY_ERASER_CONSUMER_NAME]);
    await expect(kms.getKey(recordSubject)).rejects.toBeInstanceOf(KeyErasedError);

    const rows = await selectMany<{ tenantId: string; payload: unknown }>(stack.db, eventsTable, {
      type: SUBJECT_FORGOTTEN_EVENT_NAME,
    });
    const forgotten = rows.map((e) => ({
      tenantId: e.tenantId,
      subjectKey: subjectForgottenSchema.parse(e.payload).subjectKey,
    }));
    const recordKey = subjectIdToKey(recordSubject);
    const userKey = subjectIdToKey({ kind: "user", userId: OWNER });
    expect(forgotten.find((e) => e.subjectKey === recordKey)?.tenantId).toBe(
      dpoUserOtherTenant.tenantId,
    );
    expect(
      forgotten.filter((e) => e.tenantId === dpoUser.tenantId && e.subjectKey === recordKey),
    ).toEqual([]);
    expect(forgotten.find((e) => e.subjectKey === userKey)?.tenantId).toBe(dpoUser.tenantId);
  });
});
