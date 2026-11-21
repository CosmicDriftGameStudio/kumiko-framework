// Accounts created before emails were lower-cased keep the address as typed, encrypted, with a
// blind index over that raw value; every lookup lower-cases its input and misses them. The legacy
// rows are written through the executor without the handler's normalization, as 0.424 did.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  configureBlindIndexKey,
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  type SubjectId,
} from "@cosmicdrift/kumiko-framework/crypto";
import {
  alignLiveRowVersionsWithStreams,
  createEventStoreExecutor,
  selectMany,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  defineFeature,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { append, eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createTenantDb } from "@cosmicdrift/kumiko-framework/internal/row-level-security";
import {
  createTestEnvelopeCipher,
  resetBlindIndexKeyForTests,
  resetPiiSubjectKmsForTests,
  resetTestTables,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { createAuthEmailPasswordFeature } from "../../auth-email-password/feature.ts";
import { AuthErrors, AuthHandlers } from "../../auth-email-password/web/constants.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { hashPassword } from "../../shared/index.ts";
import { createTenantFeature } from "../../tenant/index.ts";
import { tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { seedTenantMembership } from "../../tenant/testing.ts";
import { createUserFeature } from "../feature.ts";
import { normalizeStoredUserEmails } from "../normalize-stored-emails.ts";
import { userEntity, userTable } from "../schema/user.ts";

const PASSWORD = "legacy-account-pw-2026";
const MEMBER_TENANT: TenantId = "00000000-0000-4000-8000-000000000001" as TenantId;
const USER_NOTED_EVENT = "user-notes:event:noted";

// A domain event on the user stream, the shape an app feature appends on a user aggregate.
const userNotesFeature = defineFeature("user-notes", (r) => {
  r.defineEvent("noted", z.object({ note: z.string() }), { piiFields: "none" });
});

const legacyUserExecutor = createEventStoreExecutor(userTable, userEntity, { entityName: "user" });

let stack: TestStack;

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createAuthEmailPasswordFeature(),
      userNotesFeature,
    ],
    extraContext: {
      configResolver: createConfigResolver({ cipher: encryption }),
      configEncryption: encryption,
    },
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
      loginErrorStatusMap: {
        [AuthErrors.invalidCredentials]: 401,
        [AuthErrors.noMembership]: 403,
      },
    },
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [userTable, tenantMembershipsTable, eventsTable]);
  await stack.redis.flushNamespace();
  configurePiiSubjectKms(new InMemoryKmsAdapter());
  configureBlindIndexKey(Buffer.alloc(32, 21).toString("base64"));
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
  resetBlindIndexKeyForTests();
});

async function createUserAsStoredBefore(email: string): Promise<string> {
  const by = createSystemUser(SYSTEM_TENANT_ID);
  const tdb = createTenantDb({
    db: stack.db,
    tenantId: by.tenantId,
    mode: "system",
    reason: "User is tenant-agnostic, the legacy row is written through a system-mode handle",
  });
  const result = await legacyUserExecutor.create(
    { email, displayName: "Max", passwordHash: await hashPassword(PASSWORD) },
    by,
    tdb,
  );
  if (!result.isSuccess) throw new Error(`legacy user insert failed: ${result.error.code}`);
  const id = String(result.data["id"]);
  await seedTenantMembership(stack.db, { userId: id, tenantId: MEMBER_TENANT, roles: ["User"] });
  return id;
}

async function login(email: string): Promise<Response> {
  return stack.http.raw("POST", "/api/auth/login", { email, password: PASSWORD });
}

describe("normalizeStoredUserEmails", () => {
  test("an account stored with upper case can log in with the lower-case address afterwards", async () => {
    const id = await createUserAsStoredBefore("Max@X.de");
    expect((await login("max@x.de")).status).toBe(401);

    const result = await normalizeStoredUserEmails(stack.db);

    expect(result).toEqual({
      rewrittenUserIds: [id],
      duplicateUserIds: [],
      versionConflictUserIds: [],
      undecryptableUserIds: [],
      failedUsers: [],
    });
    const res = await login("max@x.de");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { user: { id: string } }).user.id).toBe(id);
  });

  test("accounts beyond the first batch are normalized too", async () => {
    const ids = [
      await createUserAsStoredBefore("a1@x.de"),
      await createUserAsStoredBefore("A2@X.de"),
      await createUserAsStoredBefore("a3@x.de"),
      await createUserAsStoredBefore("A4@X.de"),
      await createUserAsStoredBefore("A5@X.de"),
    ];

    const result = await normalizeStoredUserEmails(stack.db, { batchSize: 2 });

    expect([...result.rewrittenUserIds].sort()).toEqual(
      [ids[1], ids[3], ids[4]].filter((id): id is string => id !== undefined).sort(),
    );
    expect((await login("a5@x.de")).status).toBe(200);
  });

  test("a second run rewrites nothing and appends no event", async () => {
    await createUserAsStoredBefore("Max@X.de");
    await normalizeStoredUserEmails(stack.db);
    const eventsAfterFirstRun = (await selectMany(stack.db, eventsTable)).length;

    const second = await normalizeStoredUserEmails(stack.db);

    expect(second.rewrittenUserIds).toEqual([]);
    expect((await selectMany(stack.db, eventsTable)).length).toBe(eventsAfterFirstRun);
  });

  test("an existing lower-case account stays, the upper-case duplicate is only reported", async () => {
    const legacyId = await createUserAsStoredBefore("Dup@X.de");
    const lowerId = await createUserAsStoredBefore("dup@x.de");

    const result = await normalizeStoredUserEmails(stack.db);

    expect(result.rewrittenUserIds).toEqual([]);
    expect(result.duplicateUserIds).toEqual([legacyId]);
    const users = await selectMany<{ id: string; version: number }>(stack.db, userTable);
    expect(users.map((u) => u.id).sort()).toEqual([legacyId, lowerId].sort());
    expect(users.every((u) => u.version === 1)).toBe(true);
    const res = await login("dup@x.de");
    expect(((await res.json()) as { user: { id: string } }).user.id).toBe(lowerId);
  });

  test("a row behind its stream reports version_conflict instead of passing, and is repaired once aligned", async () => {
    const id = await createUserAsStoredBefore("Late@X.de");
    await append(stack.db, {
      aggregateId: id,
      aggregateType: "user",
      tenantId: SYSTEM_TENANT_ID,
      expectedVersion: 1,
      type: USER_NOTED_EVENT,
      payload: { note: "written by a release that left row.version behind" },
      metadata: { userId: "test-legacy" },
    });

    const beforeAlign = await normalizeStoredUserEmails(stack.db);
    expect(beforeAlign.versionConflictUserIds).toEqual([id]);
    expect(beforeAlign.rewrittenUserIds).toEqual([]);

    await alignLiveRowVersionsWithStreams(stack.db, userTable.tableName, ["user"], true);
    const afterAlign = await normalizeStoredUserEmails(stack.db);

    expect(afterAlign.rewrittenUserIds).toEqual([id]);
    expect((await login("late@x.de")).status).toBe(200);
  });

  test("a rewrite that throws is reported by code and the following accounts are still normalized", async () => {
    const kms = new KmsLostAfterFirstRead();
    configurePiiSubjectKms(kms);
    const brokenId = await createUserAsStoredBefore("Broken@X.de");
    const laterId = await createUserAsStoredBefore("Later@X.de");
    kms.lostUserId = brokenId;

    const result = await normalizeStoredUserEmails(stack.db);

    expect(result.failedUsers).toEqual([{ userId: brokenId, code: "EncryptionUnavailableError" }]);
    expect(JSON.stringify(result)).not.toContain("roken@");
    expect(result.rewrittenUserIds).toEqual([laterId]);
    expect((await login("later@x.de")).status).toBe(200);
  });
});

// The subject key answers the decrypt, then the KMS is gone for that subject, so the rewrite throws.
class KmsLostAfterFirstRead extends InMemoryKmsAdapter {
  lostUserId: string | undefined;
  private readsOfLostUser = 0;

  override async getKey(subject: SubjectId): Promise<Buffer> {
    if (subject.kind === "user" && subject.userId === this.lostUserId) {
      this.readsOfLostUser += 1;
      if (this.readsOfLostUser > 1) throw new Error("KMS unavailable");
    }
    return super.getKey(subject);
  }
}
