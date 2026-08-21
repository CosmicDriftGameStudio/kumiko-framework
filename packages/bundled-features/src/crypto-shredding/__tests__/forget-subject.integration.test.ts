// crypto-shredding forget-subject — end-to-end over real HTTP dispatch:
//
//   - DPO erases a user subject → DEK gone (getKey throws KeyErased),
//     subject-forgotten audit event appended
//   - tenant subjects shred the same way
//   - repeat forget is a no-op erase but still audited
//   - no KMS configured → 500 with actionable message
//   - Member role → 403 (DPO/SystemAdmin only)

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { fetchOne, insertOne, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
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
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetPiiSubjectKmsForTests, resetTestTables } from "@cosmicdrift/kumiko-framework/testing";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { Temporal } from "temporal-polyfill";
import { authFoundationFeature } from "../../auth-foundation";
import { createConfigFeature } from "../../config";
import { createPersonalAccessTokensFeature } from "../../personal-access-tokens/feature";
import { apiTokenEntity, apiTokenTable } from "../../personal-access-tokens/schema/api-token";
import { createTenantFeature } from "../../tenant";
import { tenantInvitationEntity } from "../../tenant/invitation-table";
import { tenantMembershipsTable } from "../../tenant/membership-table";
import { seedTenantMembership } from "../../tenant/seeding";
import { USER_STATUS, userEntity, userTable } from "../../user";
import { createUserFeature } from "../../user/feature";
import { seedUser } from "../../user/seeding";
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

  test("tenant subject shreds the same way (DPO's own tenant)", async () => {
    const subject = { kind: "tenant", tenantId: TENANT } as const;
    await kms.createKey({ kind: "tenant", tenantId: TENANT });

    const result = await stack.http.writeOk<{ subjectKey: string }>(
      FORGET,
      { subject, reason: REASON },
      dpoUser,
    );
    expect(result.subjectKey).toBe(`tenant:${TENANT}`);

    await expect(kms.getKey({ kind: "tenant", tenantId: TENANT })).rejects.toThrow(
      "Subject key erased",
    );
  });

  // mh#349: DataProtectionOfficer is tenant-scoped — a DPO who learns a
  // foreign tenant's id (export, support ticket, log line) must not be able
  // to destroy that tenant's subject key.
  test("DPO cannot forget a different tenant's subject → 403", async () => {
    const subject = { kind: "tenant", tenantId: TARGET_TENANT_ID } as const;
    await kms.createKey({ kind: "tenant", tenantId: TARGET_TENANT_ID as TenantId });

    const err = await stack.http.writeErr(FORGET, { subject, reason: REASON }, dpoUser);
    expect(err.httpStatus).toBe(403);

    await expect(
      kms.getKey({ kind: "tenant", tenantId: TARGET_TENANT_ID as TenantId }),
    ).resolves.toBeTruthy();
  });

  test("SystemAdmin bypasses the tenant-scope guard", async () => {
    const subject = { kind: "tenant", tenantId: TARGET_TENANT_ID } as const;
    await kms.createKey({ kind: "tenant", tenantId: TARGET_TENANT_ID as TenantId });

    const result = await stack.http.writeOk<{ subjectKey: string }>(
      FORGET,
      { subject, reason: REASON },
      TestUsers.systemAdmin,
    );
    expect(result.subjectKey).toBe(`tenant:${TARGET_TENANT_ID}`);
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
        personal: { of: "ownerId" },
        find: "fuzzy",
      }),
      tenantNote: createTextField({
        required: true,
        maxLength: 100,
        personal: "tenant",
        find: "fuzzy",
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

// The P2 audit finding: forget-subject shredded the DEK but left status +
// PATs untouched — a forgotten user's credentials stayed live (PAT resolver
// checks revokedAt/expiresAt, never user.status). Own stack with user +
// personal-access-tokens mounted (the handler's user-lifecycle + PAT-revoke
// branches guard on those features).
describe("crypto-shredding :: forget-subject closes the login door (user feature mounted)", () => {
  let stack: TestStack;
  let kms: InMemoryKmsAdapter;
  const TENANT_B = testTenantId(3);

  // mh#349: a "user"-kind subject isn't always a real user — a share-token
  // recipient or email subscriber self-owns its PII the same way
  // (personal: "self", its own row id is the subject) but has no tenant-
  // membership row. The guard must fall back to the subject row's own
  // tenant_id for these.
  const shareLikeEntity = createEntity({
    table: "read_forget_subject_share_like_probe",
    fields: {
      recipientName: createTextField({
        required: true,
        maxLength: 100,
        personal: "self",
        find: "exact",
      }),
    },
  });
  const shareLikeTable = buildEntityTable("forgetSubjectShareLikeProbe", shareLikeEntity);
  const shareLikeFeature = defineFeature("forget-subject-share-like-probe", (r) => {
    r.entity("probe", shareLikeEntity);
  });

  function shareLikeProbeExecutor() {
    return createEventStoreExecutor(shareLikeTable, shareLikeEntity, { entityName: "probe" });
  }

  beforeAll(async () => {
    stack = await setupTestStack({
      features: [
        createCryptoShreddingFeature(),
        createUserFeature(),
        createTenantFeature(),
        createConfigFeature(),
        authFoundationFeature,
        createPersonalAccessTokensFeature({ scopes: {} }),
        shareLikeFeature,
      ],
    });
    await unsafeCreateEntityTable(stack.db, userEntity);
    await unsafeCreateEntityTable(stack.db, apiTokenEntity);
    // tenant feature's only lookupable entity — the blind-index sweep
    // touches it; without the table the handler 500s on `read_tenant_invitations`.
    await unsafeCreateEntityTable(stack.db, tenantInvitationEntity);
    await unsafeCreateEntityTable(stack.db, shareLikeEntity, "probe");
    await unsafePushTables(stack.db, { tenantMembershipsTable });
    await createEventsTable(stack.db);
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  beforeEach(async () => {
    await resetTestTables(stack.db, [
      userTable,
      apiTokenTable,
      tenantMembershipsTable,
      shareLikeTable,
      eventsTable,
    ]);
    kms = new InMemoryKmsAdapter();
    configurePiiSubjectKms(kms);
  });

  afterEach(() => {
    resetPiiSubjectKmsForTests();
  });

  test("user forget flips status to Deleted and revokes existing PATs", async () => {
    const { id: userId } = await seedUser(stack.db, {
      email: "forgotten@example.com",
      displayName: "Forgotten User",
      emailVerified: true,
    });
    await seedTenantMembership(stack.db, { userId, tenantId: TENANT, roles: ["Member"] });
    // No explicit createKey: seedUser's PII-encrypt (email) already created
    // the subject key implicitly via getOrCreateDek.
    await insertOne(stack.db, apiTokenTable, {
      id: generateId(),
      userId,
      tenantId: TENANT_B,
      name: "legacy-pat",
      tokenHash: "a".repeat(64),
      prefix: "ktest",
      scopes: "[]",
      createdAt: Temporal.Now.instant(),
    });

    await stack.http.writeOk(
      FORGET,
      { subject: { kind: "user", userId }, reason: REASON },
      dpoUser,
    );

    const userRow = await fetchOne<Record<string, unknown>>(stack.db, userTable, { id: userId });
    expect(userRow?.["status"]).toBe(USER_STATUS.Deleted);

    const tokens = await selectMany(stack.db, apiTokenTable, { userId });
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.["revokedAt"]).not.toBeNull();
  });

  // mh#349: a DPO must not be able to forget a user who has no membership in
  // their own tenant (e.g. a Tenant-A DPO who learned a Tenant-B user id).
  test("DPO cannot forget a user with no membership in their tenant → 403", async () => {
    const { id: userId } = await seedUser(stack.db, {
      email: "foreign-tenant-user@example.com",
      displayName: "Foreign Tenant User",
      emailVerified: true,
    });
    await seedTenantMembership(stack.db, { userId, tenantId: TENANT_B, roles: ["Member"] });

    const err = await stack.http.writeErr(
      FORGET,
      { subject: { kind: "user", userId }, reason: REASON },
      dpoUser,
    );
    expect(err.httpStatus).toBe(403);

    const userRow = await fetchOne<Record<string, unknown>>(stack.db, userTable, { id: userId });
    expect(userRow?.["status"]).not.toBe(USER_STATUS.Deleted);
  });

  test("SystemAdmin can forget a user with no membership in any tenant", async () => {
    const { id: userId } = await seedUser(stack.db, {
      email: "system-admin-forgets@example.com",
      displayName: "System Admin Forgets",
      emailVerified: true,
    });

    await stack.http.writeOk(
      FORGET,
      { subject: { kind: "user", userId }, reason: REASON },
      TestUsers.systemAdmin,
    );

    const userRow = await fetchOne<Record<string, unknown>>(stack.db, userTable, { id: userId });
    expect(userRow?.["status"]).toBe(USER_STATUS.Deleted);
  });

  test("DPO can forget a self-owned PII subject (share-token-like) in their own tenant", async () => {
    const created = await shareLikeProbeExecutor().create(
      { recipientName: "Tommy Recipient" },
      dpoUser,
      createTenantDb(stack.db, TENANT, "system"),
    );
    if (!created.isSuccess) throw new Error("create failed");
    const subjectId = String(created.data.id);

    const result = await stack.http.writeOk<{ subjectKey: string }>(
      FORGET,
      { subject: { kind: "user", userId: subjectId }, reason: REASON },
      dpoUser,
    );
    expect(result.subjectKey).toBe(`user:${subjectId}`);
  });

  test("DPO cannot forget another tenant's self-owned PII subject → 403", async () => {
    // create()'s event stream is tenant-scoped to the AUTHOR, not the
    // tenantDb override — an actor whose own tenantId is TENANT_B is
    // required to actually seed the row under the foreign tenant.
    const foreignTenantAuthor = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-0000000000f2",
      tenantId: TENANT_B,
      roles: ["Member"],
    };
    const created = await shareLikeProbeExecutor().create(
      { recipientName: "Peter Recipient" },
      foreignTenantAuthor,
      createTenantDb(stack.db, TENANT_B, "system"),
    );
    if (!created.isSuccess) throw new Error("create failed");
    const subjectId = String(created.data.id);

    const err = await stack.http.writeErr(
      FORGET,
      { subject: { kind: "user", userId: subjectId }, reason: REASON },
      dpoUser,
    );
    expect(err.httpStatus).toBe(403);
  });
});
