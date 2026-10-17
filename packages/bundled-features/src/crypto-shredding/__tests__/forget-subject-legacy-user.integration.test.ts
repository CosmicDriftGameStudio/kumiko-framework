import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  configureBlindIndexKey,
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
} from "@cosmicdrift/kumiko-framework/crypto";
import { fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
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
import { createAuthFoundationFeature } from "../../auth-foundation/index.js";
import { createConfigFeature } from "../../config/index.js";
import { createPersonalAccessTokensFeature } from "../../personal-access-tokens/feature.js";
import { apiTokenEntity } from "../../personal-access-tokens/schema/api-token.js";
import { createTenantFeature } from "../../tenant/index.js";
import { tenantInvitationEntity } from "../../tenant/invitation-table.js";
import { tenantMembershipsTable } from "../../tenant/membership-table.js";
import { seedTenantMembership } from "../../tenant/seeding.js";
import { createUserFeature } from "../../user/feature.js";
import { USER_STATUS, userEntity, userTable } from "../../user/index.js";
import { seedUser } from "../../user/seeding.js";
import { SUBJECT_FORGOTTEN_EVENT_NAME } from "../constants.js";
import { createCryptoShreddingFeature } from "../feature.js";

const FORGET = "crypto-shredding:write:forget-subject";
const TENANT: TenantId = testTenantId(1);
const REASON = "authority request #3799 (Art. 17)";
const dpoUser = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-0000000000d1",
  tenantId: TENANT,
  roles: ["DataProtectionOfficer"],
};

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createCryptoShreddingFeature(),
      createUserFeature(),
      createTenantFeature(),
      createConfigFeature(),
      createAuthFoundationFeature(),
      createPersonalAccessTokensFeature({ scopes: {} }),
    ],
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, apiTokenEntity);
  await unsafeCreateEntityTable(stack.db, tenantInvitationEntity);
  await unsafePushTables(stack.db, { tenantMembershipsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
  resetBlindIndexKeyForTests();
});

async function forget(userId: string) {
  await seedTenantMembership(stack.db, { userId, tenantId: TENANT, roles: ["Member"] });
  const res = await stack.http.write(
    FORGET,
    { subject: { kind: "user", userId }, reason: REASON },
    dpoUser,
  );
  const body = (await res.json()) as { isSuccess: boolean };
  const row = await fetchOne<Record<string, unknown>>(stack.db, userTable, { id: userId });
  return { status: res.status, body, userStatus: row?.["status"] };
}

async function expectForgotten(userId: string, kms: InMemoryKmsAdapter) {
  const result = await forget(userId);
  expect(result.status).toBe(200);
  expect(result.body.isSuccess).toBe(true);
  expect(result.userStatus).toBe(USER_STATUS.Deleted);
  await expect(kms.getKey({ kind: "user", userId })).rejects.toThrow("Subject key erased");
  const audit = await selectMany(stack.db, eventsTable, {
    type: SUBJECT_FORGOTTEN_EVENT_NAME,
    aggregateId: userId,
  });
  expect(audit.length).toBeGreaterThanOrEqual(1);
}

describe("forget-subject for users stored before the KMS or without an event stream", () => {
  test("plaintext user, KMS configured afterwards", async () => {
    const { id } = await seedUser(stack.db, { email: "legacy-a@example.com", displayName: "A" });
    const kms = new InMemoryKmsAdapter();
    configurePiiSubjectKms(kms);
    await expectForgotten(id, kms);
  });

  test("keyed user whose events were removed", async () => {
    const kms = new InMemoryKmsAdapter();
    configurePiiSubjectKms(kms);
    const { id } = await seedUser(stack.db, { email: "legacy-b@example.com", displayName: "B" });
    await resetTestTables(stack.db, [eventsTable]);
    await expectForgotten(id, kms);
  });

  test("plaintext user without events, KMS configured afterwards", async () => {
    const { id } = await seedUser(stack.db, { email: "legacy-c@example.com", displayName: "C" });
    await resetTestTables(stack.db, [eventsTable]);
    const kms = new InMemoryKmsAdapter();
    configurePiiSubjectKms(kms);
    await expectForgotten(id, kms);
  });

  test("a second forget of the same user is idempotent", async () => {
    const kms = new InMemoryKmsAdapter();
    configurePiiSubjectKms(kms);
    const { id } = await seedUser(stack.db, { email: "legacy-d@example.com", displayName: "D" });
    await expectForgotten(id, kms);
    expect((await forget(id)).status).toBe(200);
  });

  test("two users forgotten with a blind-index key configured", async () => {
    configureBlindIndexKey(Buffer.alloc(32, 11).toString("base64"));
    const kms = new InMemoryKmsAdapter();
    configurePiiSubjectKms(kms);
    const first = await seedUser(stack.db, { email: "legacy-f1@example.com", displayName: "F1" });
    const second = await seedUser(stack.db, { email: "legacy-f2@example.com", displayName: "F2" });
    await expectForgotten(first.id, kms);
    await expectForgotten(second.id, kms);
  });
});
