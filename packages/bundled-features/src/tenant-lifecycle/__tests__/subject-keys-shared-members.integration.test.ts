// The subject-keys stage erases the user keys of the destroyed tenant's members, but a user who
// still belongs to another live tenant must keep a usable key: a tombstone would make every later
// PII write for that user fail with subject_erased.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  KeyAlreadyExistsError,
  KeyErasedError,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import {
  createTestEnvelopeCipher,
  resetPiiSubjectKmsForTests,
  resetTestTables,
} from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { createComplianceProfilesFeature } from "../../compliance-profiles/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { tenantTable } from "../../tenant/schema/tenant.ts";
import { seedTenantMembership } from "../../tenant/seeding.ts";
import { updateTenantViaEventStore } from "../../tenant/testing-event-store.ts";
import { TenantHandlers } from "../../tenant/web/constants.ts";
import { createTenantLifecycleFeature } from "../feature.ts";
import { driveDestructionToCompletion, seedDestroyingTenant } from "../testing.ts";

let stack: TestStack;
let kms: InMemoryKmsAdapter;

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
    ],
    extraContext: {
      configResolver: createConfigResolver({ cipher: encryption }),
      configEncryption: encryption,
    },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [tenantTable, tenantMembershipsTable, eventsTable]);
  kms = new InMemoryKmsAdapter();
  configurePiiSubjectKms(kms);
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
});

async function createTenant(key: string): Promise<TenantId> {
  const created = await stack.http.writeOk<{ id: string }>(
    TenantHandlers.create,
    { key, name: `Tenant ${key}` },
    TestUsers.systemAdmin,
  );
  return created.id as TenantId;
}

async function addMember(tenantId: TenantId, userId: string): Promise<void> {
  await seedTenantMembership(stack.db, { tenantId, userId, roles: ["Member"] });
}

async function hasUsableKey(userId: string): Promise<boolean> {
  try {
    await kms.createKey({ kind: "user", userId });
    return true;
  } catch (e) {
    if (e instanceof KeyAlreadyExistsError) return false;
    throw e;
  }
}

describe("tenant-lifecycle :: subject-keys stage with members of several tenants", () => {
  test("a member of another live tenant keeps a usable key, a sole member is erased", async () => {
    const doomed = await createTenant("doomed");
    const survivor = await createTenant("survivor");
    const sharedUser = crypto.randomUUID();
    const soleUser = crypto.randomUUID();
    await addMember(doomed, sharedUser);
    await addMember(doomed, soleUser);
    await addMember(survivor, sharedUser);

    await seedDestroyingTenant(stack.db, doomed);
    expect(await driveDestructionToCompletion(stack, stack.db, doomed)).toBe("destroyed");

    expect(await hasUsableKey(sharedUser)).toBe(true);
    await expect(kms.getKey({ kind: "user", userId: soleUser })).rejects.toBeInstanceOf(
      KeyErasedError,
    );
  });

  test("a member whose other tenant is already destroyed is erased", async () => {
    const doomed = await createTenant("doomed");
    const gone = await createTenant("gone");
    const user = crypto.randomUUID();
    await addMember(doomed, user);
    await addMember(gone, user);
    await updateTenantViaEventStore(stack.db, gone, { status: "destroyed" });

    await seedDestroyingTenant(stack.db, doomed);
    expect(await driveDestructionToCompletion(stack, stack.db, doomed)).toBe("destroyed");

    await expect(kms.getKey({ kind: "user", userId: user })).rejects.toBeInstanceOf(KeyErasedError);
  });
});
