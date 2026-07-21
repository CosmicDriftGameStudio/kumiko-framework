// members.query.ts's decrypt-on-read fix (#1252): before the fix, an
// active PII-subject KMS meant the query returned raw ciphertext for
// email/displayName instead of decrypting them like every other PII read
// path. This pins the decrypt-on-read roundtrip with a real KMS adapter
// configured, so a later refactor can't silently re-introduce the
// ciphertext leak.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  isPiiCiphertext,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { SessionUser, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetTestTables } from "@cosmicdrift/kumiko-framework/testing";
import { createConfigFeature } from "../../config";
import { configValuesTable } from "../../config/table";
import { createUserFeature } from "../../user/feature";
import { userEntity, userTable } from "../../user/schema/user";
import { seedUser } from "../../user/seeding";
import { TenantQueries } from "../constants";
import { createTenantFeature } from "../feature";
import { tenantMembershipsTable } from "../membership-table";
import { tenantEntity } from "../schema/tenant";
import { seedTenant, seedTenantMembership } from "../seeding";

const tenantId = testTenantId(1) as TenantId;

let stack: TestStack;

function tenantAdmin(userId: string): SessionUser {
  return { id: userId, tenantId, roles: ["TenantAdmin"] };
}

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createConfigFeature(), createUserFeature(), createTenantFeature()],
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
});

beforeEach(async () => {
  await resetTestTables(stack.db, [userTable, tenantMembershipsTable]);
  await seedTenant(stack.db, { id: tenantId, key: "tenant-kms-members", name: "KMS Tenant" });
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
});

afterAll(async () => {
  await stack.cleanup();
});

describe("members query — decrypt-on-read with an active KMS (#1252)", () => {
  test("email and displayName come back as plaintext, not ciphertext", async () => {
    // KMS active BEFORE the seed — seedUser runs through the executor, so
    // the row reflects the encrypted prod state.
    configurePiiSubjectKms(new InMemoryKmsAdapter());
    const { id: userId } = await seedUser(stack.db, {
      email: "kms-member@example.com",
      displayName: "KMS Member",
      emailVerified: true,
    });
    await seedTenantMembership(stack.db, { userId, tenantId, roles: ["User"] });

    // Prove the row is actually ciphertext at rest — otherwise a no-op
    // encryption path would make this test pass while proving nothing.
    const rawRows = await selectMany<{ email: unknown; displayName: unknown }>(
      stack.db,
      userTable,
      {
        id: userId,
      },
    );
    expect(isPiiCiphertext(rawRows[0]?.email)).toBe(true);
    expect(isPiiCiphertext(rawRows[0]?.displayName)).toBe(true);

    const members = await stack.http.queryOk<
      readonly { userId: string; email: string | null; displayName: string | null }[]
    >(TenantQueries.members, {}, tenantAdmin(userId));

    const self = members.find((m) => m.userId === userId);
    expect(self?.email).toBe("kms-member@example.com");
    expect(self?.displayName).toBe("KMS Member");
  });
});
