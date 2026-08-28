// offlot#114 — DB integration for seedAdminGuarded, the boot-seed variant
// of seedAdmin that survives a blind-index miss on an otherwise-existing
// account. Runs against a KMS + blind-index setup, which is the only
// configuration where the bug reproduces: `email` holds per-row ciphertext,
// so seedAdmin's idempotency check can only match through the deterministic
// `email_bidx` companion column.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configureBlindIndexKey,
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable, eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  resetBlindIndexKeyForTests,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-framework/testing";
import { createConfigFeature } from "../../config/feature";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createTenantFeature } from "../../tenant/feature";
import { tenantMembershipsTable } from "../../tenant/membership-table";
import { tenantEntity, tenantTable } from "../../tenant/schema/tenant";
import { createUserFeature } from "../../user/feature";
import { userEntity, userTable } from "../../user/schema/user";
import { seedUser } from "../../user/seeding";
import { seedAdmin, seedAdminGuarded } from "../seeding";

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
  await createEventsTable(stack.db);
}, 60_000);

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantMembershipsTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${eventsTable.tableName}"`);
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

/** Reproduces the offlot#112 row shape in prod: the email column keeps its
 *  ciphertext, but the blind index is blank — as it is for rows written
 *  before KUMIKO_BLIND_INDEX_KEY existed, or after a subject-key erase. */
async function blankBlindIndex(): Promise<void> {
  await asRawClient(stack.db).unsafe(`UPDATE "${userTable.tableName}" SET email_bidx = NULL`);
}

describe("seedAdminGuarded (offlot#114)", () => {
  test("re-seeding twice on an empty DB stays idempotent", async () => {
    const first = await seedAdminGuarded(stack.db, seedOptions);
    const second = await seedAdminGuarded(stack.db, seedOptions);

    expect(second.id).toBe(first.id);
    expect(await userIds()).toEqual([first.id]);
    expect(await membershipUserIds()).toEqual([first.id]);
  });

  test("a blank blind index no longer produces a second account", async () => {
    const first = await seedAdminGuarded(stack.db, seedOptions);
    await blankBlindIndex();

    const second = await seedAdminGuarded(stack.db, seedOptions);

    expect(second.id).toBe(first.id);
    expect(await userIds()).toEqual([first.id]);
    // Membership is reconciled onto the existing account, not a new identity.
    expect(await membershipUserIds()).toEqual([first.id]);
  });

  test("unguarded seedAdmin still duplicates on a blank blind index — the gap seedAdminGuarded covers", async () => {
    // Pins the framework behaviour the guard compensates for: seedUser's
    // existence check is bidx-only, and neither unique index on the user
    // table can catch this (the plaintext unique index sits on randomized
    // ciphertext, the bidx unique index is partial WHERE email_bidx IS NOT
    // NULL). If this ever fails, seedAdmin's idempotency check changed and
    // this guard can be revisited.
    const first = await seedAdmin(stack.db, seedOptions);
    await blankBlindIndex();

    const second = await seedAdmin(stack.db, seedOptions);

    expect(second.id).not.toBe(first.id);
    expect(await userIds()).toHaveLength(2);
  });

  test("pre-existing duplicates are reused, never extended", async () => {
    // Build the exact prod state: two ciphertext rows for one email, the
    // older one with a blank blind index.
    const canonical = await seedAdmin(stack.db, seedOptions);
    await blankBlindIndex();
    const duplicate = await seedAdmin(stack.db, seedOptions);
    expect(await userIds()).toHaveLength(2);

    // Guards against a false pass: the canonical pick must be driven by
    // insertedAt ordering, not a coincidental id sort — assert the rows
    // actually carry distinct, comparable Temporal.Instant timestamps.
    const rows = await selectMany<{ id: string; insertedAt: { epochNanoseconds: bigint } }>(
      stack.db,
      userTable,
    );
    const canonicalRow = rows.find((r) => r.id === canonical.id);
    const duplicateRow = rows.find((r) => r.id === duplicate.id);
    expect(typeof canonicalRow?.insertedAt.epochNanoseconds).toBe("bigint");
    expect(typeof duplicateRow?.insertedAt.epochNanoseconds).toBe("bigint");
    expect(
      canonicalRow!.insertedAt.epochNanoseconds < duplicateRow!.insertedAt.epochNanoseconds,
    ).toBe(true);

    const seeded = await seedAdminGuarded(stack.db, seedOptions);

    // Oldest row wins.
    expect(seeded.id).toBe(canonical.id);
    expect(seeded.id).not.toBe(duplicate.id);
    // No third row: the guard refuses to add to a broken state.
    expect(await userIds()).toHaveLength(2);
  });

  test("unrelated single-row accounts are untouched", async () => {
    const unrelated = await seedUser(stack.db, {
      email: "dealer@offlot.app",
      displayName: "Dealer",
    });
    const admin = await seedAdminGuarded(stack.db, seedOptions);
    await blankBlindIndex();
    await seedAdminGuarded(stack.db, seedOptions);

    expect(await userIds()).toHaveLength(2);
    expect((await userIds()).slice().sort()).toEqual([unrelated.id, admin.id].sort());
  });
});
