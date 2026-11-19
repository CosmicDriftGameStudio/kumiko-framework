// The grace period of a (global) account deletion must not be steerable by one tenant: it is the
// longest period over all the user's tenants, never below the platform floor.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { resetTestTables, seedRowViaEventStore } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "../../compliance-profiles/index.ts";
import { seedComplianceProfile } from "../../compliance-profiles/seeding.ts";
import { createDataRetentionFeature } from "../../data-retention/index.ts";
import { createSessionsFeature, userSessionEntity } from "../../sessions/index.ts";
import { tenantMembershipEntity, tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { createUserFeature } from "../../user/feature.ts";
import { USER_STATUS, userEntity, userTable } from "../../user/index.ts";
import { createUserDataRightsFeature } from "../feature.ts";

const REQUEST_DELETION = "user-data-rights:write:request-deletion";
const PLATFORM_FLOOR_DAYS = 7;
const PLATFORM_CEILING_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

const tenantA = testTenantId(1);
const tenantB = testTenantId(2);
const alice = createTestUser({ id: 42, tenantId: tenantA, roles: ["Member"] });

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createUserFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createAuthFoundationFeature(),
      createSessionsFeature(),
      createUserDataRightsFeature(),
    ],
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, userSessionEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(stack.db, tenantMembershipEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [
    userTable,
    tenantComplianceProfileTable,
    tenantMembershipsTable,
    eventsTable,
  ]);
  await seedRowViaEventStore(stack.db, userTable, {
    id: alice.id,
    email: "alice.grace@example.com",
    passwordHash: "hashed",
    displayName: "Alice",
    locale: "de",
    emailVerified: true,
    roles: '["Member"]',
    status: USER_STATUS.Active,
    gracePeriodEnd: null,
  });
});

async function setGraceDays(tenantId: typeof tenantA, days: number): Promise<void> {
  await seedComplianceProfile(stack.db, {
    tenantId,
    profileKey: "eu-dsgvo",
    override: { userRights: { gracePeriod: { days } } },
  });
}

async function seedMembership(tenantId: typeof tenantA): Promise<void> {
  await seedRowViaEventStore(stack.db, tenantMembershipsTable, {
    tenantId,
    userId: alice.id,
    roles: '["Member"]',
  });
}

async function requestedGraceDays(): Promise<number> {
  const result = await stack.http.writeOk<{ gracePeriodEnd: string }>(REQUEST_DELETION, {}, alice);
  return (new Date(result.gracePeriodEnd).getTime() - Date.now()) / DAY_MS;
}

describe("request-deletion grace period", () => {
  test("a tenant profile with 0 days is lifted to the platform floor", async () => {
    await setGraceDays(tenantA, 0);
    await seedMembership(tenantA);

    const days = await requestedGraceDays();

    expect(days).toBeGreaterThan(PLATFORM_FLOOR_DAYS - 0.01);
    expect(days).toBeLessThan(PLATFORM_FLOOR_DAYS + 0.01);
  });

  test("a user in two tenants gets the longest of their grace periods", async () => {
    await setGraceDays(tenantA, 14);
    await setGraceDays(tenantB, 30);
    await seedMembership(tenantA);
    await seedMembership(tenantB);

    const days = await requestedGraceDays();

    expect(days).toBeGreaterThan(29.99);
    expect(days).toBeLessThan(30.01);
  });

  test("a tenant profile with 3650 days is capped at the platform ceiling", async () => {
    await setGraceDays(tenantA, 3650);
    await seedMembership(tenantA);

    const days = await requestedGraceDays();

    expect(days).toBeGreaterThan(PLATFORM_CEILING_DAYS - 0.01);
    expect(days).toBeLessThan(PLATFORM_CEILING_DAYS + 0.01);
  });
});
