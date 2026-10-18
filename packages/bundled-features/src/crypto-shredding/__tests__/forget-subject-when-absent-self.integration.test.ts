// personal: { of, whenAbsent: "self" } (fw#3811): a record-forget shreds the
// fields of an ownerless row (value + blind index) while owner-keyed values of
// other rows and tenant-keyed fields of the same row stay readable.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  configureBlindIndexKey,
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  PII_ERASED_SENTINEL,
} from "@cosmicdrift/kumiko-framework/crypto";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  resetBlindIndexKeyForTests,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-testing/helpers";
import { resetEventStore, setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { createCryptoShreddingFeature } from "../feature.ts";

const FORGET = "crypto-shredding:write:forget-subject";
const CREATE = "forget-self-probe:write:slip:create";
const LIST = "forget-self-probe:query:slip:list";
const DETAIL = "forget-self-probe:query:slip:detail";
const REASON = "authority request #3811 (Art. 17 ownerless row)";
const OWNER = "dddddddd-dddd-4ddd-8ddd-000000000001";

const slipEntity = createEntity({
  table: "read_forget_self_probe_slips",
  fields: {
    ownerId: createTextField({ personal: "ref" }),
    name: createTextField({ personal: { of: "ownerId", whenAbsent: "self" }, find: "none" }),
    code: createTextField({ personal: { of: "ownerId", whenAbsent: "self" }, find: "exact" }),
    note: createTextField({ personal: { of: "ownerId", whenAbsent: "tenant" }, find: "none" }),
  },
});

const probeFeature = defineFeature("forget-self-probe", (r) => {
  r.entity({ name: "slip", ...slipEntity });
  r.crud("slip", slipEntity, {
    write: { access: { roles: ["DataProtectionOfficer"] } },
    read: { access: { roles: ["DataProtectionOfficer"] } },
  });
});

const dpoUser = {
  id: "cccccccc-cccc-4ccc-8ccc-000000000031",
  tenantId: testTenantId(31),
  roles: ["DataProtectionOfficer"],
};

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [createCryptoShreddingFeature(), probeFeature] });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetEventStore(stack, ["read_forget_self_probe_slips"]);
  configurePiiSubjectKms(new InMemoryKmsAdapter());
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

describe("crypto-shredding :: record forget of whenAbsent: self fields (fw#3811)", () => {
  test("shreds the ownerless row's self fields and blind index; tenant-keyed and owner-keyed values stay readable", async () => {
    const ownerless = await createSlip({ name: "gone name", code: "gone-code", note: "kept note" });
    const owned = await createSlip({ ownerId: OWNER, name: "owned name", code: "owned-code" });
    expect(await idsWithCode("gone-code")).toEqual([ownerless]);

    await stack.http.writeOk(
      FORGET,
      { subject: { kind: "record", entity: "slip", id: ownerless }, reason: REASON },
      dpoUser,
    );

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
});
