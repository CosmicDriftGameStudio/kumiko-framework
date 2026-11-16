// DB integration for seedAdminGuarded, the boot-seed variant
// of seedAdmin that survives a blind-index miss on an otherwise-existing
// account. Runs against a KMS + blind-index setup, which is the only
// configuration where the bug reproduces: `email` holds per-row ciphertext,
// so seedAdmin's idempotency check can only match through the deterministic
// `email_bidx` companion column.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  configureBlindIndexKey,
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
} from "@cosmicdrift/kumiko-framework/crypto";
import { fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
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
import { createConfigFeature } from "../../config/feature.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { tenantEntity, tenantTable } from "../../tenant/schema/tenant.ts";
import { createUserFeature } from "../../user/feature.ts";
import { userEntity, userTable } from "../../user/schema/user.ts";
import { seedUser } from "../../user/seeding.ts";
import { seedAdmin, seedAdminGuarded, seedUserWithPassword } from "../seeding.ts";

const BLIND_INDEX_KEY_B64 = Buffer.alloc(32, 14).toString("base64");
const TENANT_114: TenantId = "00000000-0000-4000-8000-0000000001d4" as TenantId;
const SYSADMIN_EMAIL = "sysadmin@offlot.app";

const seedOptions = {
  email: SYSADMIN_EMAIL,
  password: "sysadmin-pw-114",
  displayName: "Sysadmin",
  globalRoles: ["SystemAdmin"],
  memberships: [
    { tenantId: TENANT_114, tenantKey: "demo-114", tenantName: "Demo 114", roles: ["TenantAdmin"] },
  ],
} as const;

let stack: TestStack;

beforeAll(async () => {
  const resolver = createConfigResolver();
  stack = await setupTestStack({
    features: [createConfigFeature(), createUserFeature(), createTenantFeature()],
    extraContext: { configResolver: resolver },
  });
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [tenantMembershipsTable, tenantTable, userTable, eventsTable]);
  configurePiiSubjectKms(new InMemoryKmsAdapter());
  configureBlindIndexKey(BLIND_INDEX_KEY_B64);
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
  resetBlindIndexKeyForTests();
});

async function userIds(): Promise<readonly string[]> {
  const rows = await selectMany<{ id: string }>(stack.db, userTable);
  return rows.map((r) => r.id);
}

async function membershipUserIds(): Promise<readonly string[]> {
  const rows = await selectMany<{ userId: string }>(stack.db, tenantMembershipsTable);
  return rows.map((r) => r.userId);
}

describe("seedAdminGuarded", () => {
  test("re-seeding twice on an empty DB stays idempotent", async () => {
    const first = await seedAdminGuarded(stack.db, seedOptions);
    const second = await seedAdminGuarded(stack.db, seedOptions);

    expect(second.id).toBe(first.id);
    expect(await userIds()).toEqual([first.id]);
    expect(await membershipUserIds()).toEqual([first.id]);
  });

  test("re-seeding with a differently cased email reuses the account", async () => {
    const first = await seedAdminGuarded(stack.db, seedOptions);
    const second = await seedAdminGuarded(stack.db, {
      ...seedOptions,
      email: SYSADMIN_EMAIL.toUpperCase(),
    });

    expect(second.id).toBe(first.id);
    expect(await userIds()).toEqual([first.id]);
  });

  test("unrelated single-row accounts are untouched", async () => {
    const unrelated = await seedUser(stack.db, {
      email: "dealer@offlot.app",
      displayName: "Dealer",
    });
    const admin = await seedAdminGuarded(stack.db, seedOptions);
    await seedAdminGuarded(stack.db, seedOptions);

    expect(await userIds()).toHaveLength(2);
    expect((await userIds()).slice().sort()).toEqual([unrelated.id, admin.id].sort());
  });

  test("a KMS without a blind-index key aborts instead of seeding a blind duplicate", async () => {
    await seedAdminGuarded(stack.db, seedOptions);
    resetBlindIndexKeyForTests();

    await expect(seedAdminGuarded(stack.db, seedOptions)).rejects.toThrow(/blind-index key/);
    expect(await userIds()).toHaveLength(1);
  });

  test("existing-user branch reconciles emailVerified onto the canonical row", async () => {
    const first = await seedAdminGuarded(stack.db, seedOptions);

    const second = await seedAdminGuarded(stack.db, { ...seedOptions, emailVerified: true });

    expect(second.id).toBe(first.id);
    expect(await userIds()).toEqual([first.id]);
    const rows = await selectMany<{ id: string; emailVerified: boolean }>(stack.db, userTable);
    expect(rows.find((r) => r.id === first.id)?.emailVerified).toBe(true);
  });

  test("a repeated boot seed with an intact blind index appends no further user event", async () => {
    await seedAdminGuarded(stack.db, seedOptions);
    const eventCount = async (): Promise<number> =>
      (await selectMany(stack.db, eventsTable, {})).length;
    const afterFirst = await eventCount();

    await seedAdminGuarded(stack.db, seedOptions);
    await seedAdminGuarded(stack.db, seedOptions);

    expect(await eventCount()).toBe(afterFirst);
  });

  test("a foreign row that cannot be decrypted does not abort the seed", async () => {
    await seedUser(stack.db, { email: "foreign@offlot.app", displayName: "Foreign" });
    // Fresh KMS store: the foreign row's subject key no longer exists.
    configurePiiSubjectKms(new InMemoryKmsAdapter());

    const admin = await seedAdminGuarded(stack.db, seedOptions);

    expect(await userIds()).toContain(admin.id);
  });

  test("without a configured KMS, seeding runs the plaintext path unguarded", async () => {
    resetPiiSubjectKmsForTests();
    resetBlindIndexKeyForTests();

    const first = await seedAdminGuarded(stack.db, seedOptions);
    const second = await seedAdminGuarded(stack.db, seedOptions);

    expect(second.id).toBe(first.id);
    expect(await userIds()).toEqual([first.id]);
  });
});

describe.each([
  { mode: "KMS", withKms: true },
  { mode: "plaintext", withKms: false },
])("seedAdminGuarded ownership proof ($mode)", ({ withKms }) => {
  beforeEach(() => {
    if (!withKms) {
      resetPiiSubjectKmsForTests();
      resetBlindIndexKeyForTests();
    }
  });

  async function verifiedFlagOf(id: string): Promise<unknown> {
    return (await fetchOne(stack.db, userTable, { id }))?.["emailVerified"];
  }

  test("a self-registered unverified account with the seed email gets no membership and is not verified", async () => {
    const squatter = await seedUserWithPassword(stack.db, {
      email: SYSADMIN_EMAIL,
      password: "attacker-chosen-password",
      displayName: "Squatter",
    });

    const seeded = await seedAdminGuarded(stack.db, { ...seedOptions, emailVerified: true });

    expect(seeded.id).toBe(squatter.id);
    expect(await membershipUserIds()).toEqual([]);
    expect(await verifiedFlagOf(squatter.id)).toBe(false);
  });

  test("an earlier seed account (unverified, same password) is verified and granted its memberships", async () => {
    const earlier = await seedAdmin(stack.db, seedOptions);
    expect(await verifiedFlagOf(earlier.id)).toBe(false);

    const seeded = await seedAdminGuarded(stack.db, { ...seedOptions, emailVerified: true });

    expect(seeded.id).toBe(earlier.id);
    expect(await verifiedFlagOf(earlier.id)).toBe(true);
    expect(await membershipUserIds()).toEqual([earlier.id]);
  });
});
