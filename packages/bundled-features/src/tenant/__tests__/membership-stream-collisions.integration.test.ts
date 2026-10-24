// Membership streams a projection replay must not see. Before seedTenantMembership consulted the
// event log, a seed after lost projection rows started a second stream for the same
// (userId, tenantId) pair, and every later rebuild of the membership projection failed on
// read_tenant_memberships_unique. The old seed path is the plain executor create used here.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  createEventStoreExecutor,
  createTenantDb,
  entityEventName,
  selectMany,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  append,
  archivedStreamsTable,
  archiveStream,
  eventsTable,
} from "@cosmicdrift/kumiko-framework/event-store";
import { TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createConfigFeature } from "../../config/index.ts";
import { configValuesTable } from "../../config/table.ts";
import { createUserFeature } from "../../user/feature.ts";
import { userEntity, userTable } from "../../user/schema/user.ts";
import { createTenantFeature } from "../feature.ts";
import { tenantMembershipEntity, tenantMembershipsTable } from "../membership-table.ts";
import { tenantEntity, tenantTable } from "../schema/tenant.ts";
import { seedTenantMembership } from "../seeding.ts";
import { backfillTenantStreamTenants } from "../stream-tenant-backfill.ts";

const MEMBER_TENANT = testTenantId(51);
const OTHER_TENANT = testTenantId(52);
const ARCHIVED_USER_ID = "01990000-0000-7000-8000-00000000a5c1";

const membershipExecutor = createEventStoreExecutor(
  tenantMembershipsTable,
  tenantMembershipEntity,
  { entityName: "tenant-membership" },
);

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createConfigFeature(), createUserFeature(), createTenantFeature()],
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
});

beforeEach(async () => {
  await resetTestTables(stack.db, [
    userTable,
    tenantMembershipsTable,
    tenantTable,
    eventsTable,
    archivedStreamsTable,
  ]);
});

afterAll(async () => {
  await stack.cleanup();
});

function memberTenantDb(tenantId: TenantId) {
  return createTenantDb({
    db: stack.db,
    tenantId,
    mode: "system",
    reason: "test writes membership streams of an explicitly named tenant",
  });
}

async function createMembershipStream(userId: string, tenantId: TenantId): Promise<string> {
  const result = await membershipExecutor.create(
    { userId, tenantId, roles: JSON.stringify(["Admin"]) },
    createSystemUser(tenantId),
    memberTenantDb(tenantId),
  );
  if (!result.isSuccess) throw new Error(`membership create failed: ${result.error.code}`);
  return String(result.data["id"]);
}

async function deleteMembershipStream(id: string, tenantId: TenantId): Promise<void> {
  const result = await membershipExecutor.delete(
    { id },
    createSystemUser(tenantId),
    memberTenantDb(tenantId),
    { streamTenantId: tenantId },
  );
  if (!result.isSuccess) throw new Error(`membership delete failed: ${result.error.code}`);
}

// Rows lost without events, as on the prod databases where the duplicates came from.
async function loseMembershipRows(): Promise<void> {
  await resetTestTables(stack.db, [tenantMembershipsTable]);
}

async function liveMembershipIds(): Promise<string[]> {
  const rows = await selectMany<{ id: string }>(stack.db, tenantMembershipsTable, {});
  return rows.map((row) => row.id).sort();
}

async function membershipStreamIds(): Promise<string[]> {
  const events = await selectMany<{ aggregateId: string }>(stack.db, eventsTable, {
    aggregateType: "tenant-membership",
  });
  return [...new Set(events.map((e) => e.aggregateId))].sort();
}

function rebuildMemberships() {
  return backfillTenantStreamTenants({ db: stack.db, registry: stack.registry, derived: "always" });
}

describe("membership streams a replay must not see", () => {
  test("archives the older stream of a colliding pair and rebuilds the newer one", async () => {
    const older = await createMembershipStream(TestUsers.user.id, MEMBER_TENANT);
    await loseMembershipRows();
    const newer = await createMembershipStream(TestUsers.user.id, MEMBER_TENANT);
    // Removed and added again: the streams never live at the same time, so nothing collides.
    const removed = await createMembershipStream(TestUsers.user.id, OTHER_TENANT);
    await deleteMembershipStream(removed, OTHER_TENANT);
    const readded = await createMembershipStream(TestUsers.user.id, OTHER_TENANT);

    const result = await rebuildMemberships();

    expect(result.failures).toEqual([]);
    expect(result.membershipStreamsArchived).toEqual([
      { aggregateId: older, reason: "duplicate", keptAggregateId: newer },
    ]);
    expect(await liveMembershipIds()).toEqual([newer, readded].sort());

    const second = await rebuildMemberships();
    expect(second.failures).toEqual([]);
    expect(second.membershipStreamsArchived).toEqual([]);
    expect(await liveMembershipIds()).toEqual([newer, readded].sort());
  });

  test("archives the membership streams of an archived user instead of reviving them", async () => {
    const lost = await createMembershipStream(ARCHIVED_USER_ID, MEMBER_TENANT);
    await loseMembershipRows();
    const live = await createMembershipStream(ARCHIVED_USER_ID, OTHER_TENANT);
    const kept = await createMembershipStream(TestUsers.user.id, MEMBER_TENANT);
    await archiveStream(stack.db, {
      tenantId: SYSTEM_TENANT_ID,
      aggregateId: ARCHIVED_USER_ID,
      aggregateType: "user",
      archivedBy: "test",
      reason: "superseded duplicate user",
    });

    const result = await rebuildMemberships();

    expect(result.failures).toEqual([]);
    expect(result.membershipStreamsArchived.map((s) => [s.aggregateId, s.reason]).sort()).toEqual(
      [
        [lost, "user_archived"],
        [live, "user_archived"],
      ].sort(),
    );
    expect(await liveMembershipIds()).toEqual([kept]);
  });

  test("keeps the memberships of a user whose stream is archived on one tenant but live on another", async () => {
    await append(stack.db, {
      aggregateId: ARCHIVED_USER_ID,
      aggregateType: "user",
      tenantId: MEMBER_TENANT,
      expectedVersion: 0,
      type: entityEventName("user", "created"),
      payload: { email: "kept@example.test" },
      metadata: { userId: "test" },
    });
    await archiveStream(stack.db, {
      tenantId: SYSTEM_TENANT_ID,
      aggregateId: ARCHIVED_USER_ID,
      aggregateType: "user",
      archivedBy: "test",
      reason: "stale copy on another tenant",
    });
    const kept = await createMembershipStream(ARCHIVED_USER_ID, MEMBER_TENANT);

    const result = await rebuildMemberships();

    expect(result.failures).toEqual([]);
    expect(result.membershipStreamsArchived).toEqual([]);
    expect(await liveMembershipIds()).toEqual([kept]);
  });

  test("seedTenantMembership reuses the live stream of a pair whose row was lost", async () => {
    const first = await seedTenantMembership(stack.db, {
      userId: TestUsers.user.id,
      tenantId: MEMBER_TENANT,
      roles: ["Admin"],
    });
    await loseMembershipRows();

    const again = await seedTenantMembership(stack.db, {
      userId: TestUsers.user.id,
      tenantId: MEMBER_TENANT,
      roles: ["Admin"],
    });

    expect(again.id).toBe(first.id);
    expect(await membershipStreamIds()).toEqual([first.id]);
    const result = await rebuildMemberships();
    expect(result.failures).toEqual([]);
    expect(await liveMembershipIds()).toEqual([first.id]);
  });

  test("seedTenantMembership starts a new stream after the previous one was removed", async () => {
    const first = await seedTenantMembership(stack.db, {
      userId: TestUsers.user.id,
      tenantId: MEMBER_TENANT,
      roles: ["Admin"],
    });
    await deleteMembershipStream(first.id, MEMBER_TENANT);

    const again = await seedTenantMembership(stack.db, {
      userId: TestUsers.user.id,
      tenantId: MEMBER_TENANT,
      roles: ["Admin"],
    });

    expect(again.id).not.toBe(first.id);
    expect(await liveMembershipIds()).toEqual([again.id]);
  });
});
