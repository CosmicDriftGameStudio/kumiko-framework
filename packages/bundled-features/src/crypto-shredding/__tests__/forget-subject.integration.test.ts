// crypto-shredding forget-subject — end-to-end over real HTTP dispatch:
//
//   - DPO erases a user subject → DEK gone (getKey throws KeyErased),
//     subject-forgotten audit event appended
//   - tenant subjects shred the same way
//   - repeat forget is a no-op erase but still audited
//   - no KMS configured → 500 with actionable message
//   - Member role → 403 (DPO/SystemAdmin only)

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  buildEntityTable,
  createEventStoreExecutor,
  createTenantDb,
} from "@cosmicdrift/kumiko-framework/db";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
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
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetPiiSubjectKmsForTests, resetTestTables } from "@cosmicdrift/kumiko-framework/testing";
import { SUBJECT_FORGOTTEN_EVENT_NAME } from "../constants";
import { createCryptoShreddingFeature } from "../feature";

const FORGET = "crypto-shredding:write:forget-subject";

let stack: TestStack;
let kms: InMemoryKmsAdapter;

const TENANT: TenantId = testTenantId(1);
const TARGET_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const TARGET_TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-0000000000a1";
const REASON = "authority request #42 (Art. 17)";

const dpoUser = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-0000000000d1",
  tenantId: TENANT,
  roles: ["DataProtectionOfficer"],
};

const memberUser = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-0000000000e1",
  tenantId: TENANT,
  roles: ["Member"],
};

beforeAll(async () => {
  stack = await setupTestStack({ features: [createCryptoShreddingFeature()] });
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [eventsTable]);
  kms = new InMemoryKmsAdapter();
  configurePiiSubjectKms(kms);
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
});

async function forgottenEvents(): Promise<Array<{ payload: Record<string, unknown> }>> {
  return (await selectMany(stack.db, eventsTable, {
    type: SUBJECT_FORGOTTEN_EVENT_NAME,
  })) as Array<{ payload: Record<string, unknown> }>;
}

describe("crypto-shredding :: forget-subject", () => {
  test("DPO forgets a user subject → key erased + audit event", async () => {
    const subject = { kind: "user", userId: TARGET_USER_ID } as const;
    await kms.createKey(subject);

    const result = await stack.http.writeOk<{ subjectKey: string }>(
      FORGET,
      { subject, reason: REASON },
      dpoUser,
    );
    expect(result.subjectKey).toBe(`user:${TARGET_USER_ID}`);

    await expect(kms.getKey(subject)).rejects.toThrow("Subject key erased");

    const events = await forgottenEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      subjectKey: `user:${TARGET_USER_ID}`,
      reason: REASON,
      forgottenBy: dpoUser.id,
    });
  });

  test("tenant subject shreds the same way", async () => {
    const subject = { kind: "tenant", tenantId: TARGET_TENANT_ID } as const;
    await kms.createKey({ kind: "tenant", tenantId: TARGET_TENANT_ID as TenantId });

    const result = await stack.http.writeOk<{ subjectKey: string }>(
      FORGET,
      { subject, reason: REASON },
      dpoUser,
    );
    expect(result.subjectKey).toBe(`tenant:${TARGET_TENANT_ID}`);

    await expect(
      kms.getKey({ kind: "tenant", tenantId: TARGET_TENANT_ID as TenantId }),
    ).rejects.toThrow("Subject key erased");
  });

  test("repeat forget: erase is a no-op but each attempt is audited", async () => {
    const subject = { kind: "user", userId: TARGET_USER_ID } as const;
    await kms.createKey(subject);

    await stack.http.writeOk(FORGET, { subject, reason: REASON }, dpoUser);
    await stack.http.writeOk(FORGET, { subject, reason: `${REASON} (repeat)` }, dpoUser);

    expect(await forgottenEvents()).toHaveLength(2);
  });

  test("no KMS configured → 500 with boot hint", async () => {
    resetPiiSubjectKmsForTests();

    const err = await stack.http.writeErr(
      FORGET,
      { subject: { kind: "user", userId: TARGET_USER_ID }, reason: REASON },
      dpoUser,
    );
    expect(err.httpStatus).toBe(500);
  });

  test("Member role → 403", async () => {
    const err = await stack.http.writeErr(
      FORGET,
      { subject: { kind: "user", userId: TARGET_USER_ID }, reason: REASON },
      memberUser,
    );
    expect(err.httpStatus).toBe(403);
  });

  test("reason shorter than 10 chars → schema reject", async () => {
    const err = await stack.http.writeErr(
      FORGET,
      { subject: { kind: "user", userId: TARGET_USER_ID }, reason: "short" },
      dpoUser,
    );
    expect(err.httpStatus).toBe(400);
  });
});

// fw#1611: forget-subject's ctx.searchAdapter wiring (forget-subject.write.ts
// → purgeSearchDocumentsForSubject) had zero end-to-end coverage — a broken
// extension registration would silently turn the whole GDPR search purge
// into a no-op. Own stack (own entity feature) so it doesn't perturb the
// scenarios above.
describe("crypto-shredding :: forget-subject purges the derived search index (#1611)", () => {
  const probeEntity = createEntity({
    table: "read_forget_subject_search_probe",
    fields: {
      ownerId: createTextField({ required: true }),
      userNote: createTextField({
        required: true,
        maxLength: 100,
        userOwned: { ownerField: "ownerId" },
        searchable: true,
      }),
      tenantNote: createTextField({
        required: true,
        maxLength: 100,
        tenantOwned: true,
        searchable: true,
      }),
    },
  });
  const probeTable = buildEntityTable("forgetSubjectSearchProbe", probeEntity);
  const probeFeature = defineFeature("forget-subject-search-probe", (r) => {
    r.entity("probe", probeEntity);
  });

  let searchStack: TestStack;
  let searchKms: InMemoryKmsAdapter;
  const admin = TestUsers.admin;

  beforeAll(async () => {
    searchStack = await setupTestStack({
      features: [createCryptoShreddingFeature(), probeFeature],
    });
    await unsafeCreateEntityTable(searchStack.db, probeEntity, "probe");
    await createEventsTable(searchStack.db);
  });

  afterAll(async () => {
    await searchStack.cleanup();
  });

  beforeEach(() => {
    searchKms = new InMemoryKmsAdapter();
    configurePiiSubjectKms(searchKms);
  });

  afterEach(() => {
    resetPiiSubjectKmsForTests();
  });

  function probeExecutor() {
    return createEventStoreExecutor(probeTable, probeEntity, {
      entityName: "probe",
      searchAdapter: searchStack.search,
    });
  }

  function probeTenantDb() {
    return createTenantDb(searchStack.db, admin.tenantId, "system");
  }

  test("forget-subject over HTTP purges userOwned rows from the search index", async () => {
    const ownerId = crypto.randomUUID();
    const userNote = "UniqueUserOwnedNote1611";
    const created = await probeExecutor().create(
      { ownerId, userNote, tenantNote: "irrelevant-tenant-note" },
      admin,
      probeTenantDb(),
    );
    if (!created.isSuccess) throw new Error("create failed");
    const id = String(created.data.id);

    await searchStack.eventDispatcher?.runOnce();
    expect(
      (await searchStack.search.search(admin.tenantId, userNote, { filterType: "probe" })).some(
        (h) => String(h.entityId) === id,
      ),
    ).toBe(true);

    await searchStack.http.writeOk(
      FORGET,
      { subject: { kind: "user", userId: ownerId }, reason: REASON },
      dpoUser,
    );

    const after = await searchStack.search.search(admin.tenantId, userNote, {
      filterType: "probe",
    });
    expect(after.some((h) => String(h.entityId) === id)).toBe(false);
  });

  test("forget-subject over HTTP purges tenantOwned rows from the search index", async () => {
    const tenantNote = "UniqueTenantOwnedNote1611";
    const created = await probeExecutor().create(
      { ownerId: crypto.randomUUID(), userNote: "irrelevant-user-note", tenantNote },
      admin,
      probeTenantDb(),
    );
    if (!created.isSuccess) throw new Error("create failed");
    const id = String(created.data.id);

    await searchStack.eventDispatcher?.runOnce();
    expect(
      (await searchStack.search.search(admin.tenantId, tenantNote, { filterType: "probe" })).some(
        (h) => String(h.entityId) === id,
      ),
    ).toBe(true);

    await searchStack.http.writeOk(
      FORGET,
      { subject: { kind: "tenant", tenantId: admin.tenantId }, reason: REASON },
      dpoUser,
    );

    const after = await searchStack.search.search(admin.tenantId, tenantNote, {
      filterType: "probe",
    });
    expect(after.some((h) => String(h.entityId) === id)).toBe(false);
  });
});
