// Membership streams a projection replay must not see. Before seedTenantMembership consulted the
// event log, a seed after lost projection rows started a second stream for the same
// (userId, tenantId) pair, and every later rebuild of the membership projection failed on
// read_tenant_memberships_unique. The old seed path is the plain executor create used here.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  createEventStoreExecutor,
  createTenantDb,
  selectMany,
} from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { archivedStreamsTable, eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { rebuildProjection } from "@cosmicdrift/kumiko-framework/pipeline";
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

const MEMBER_TENANT = testTenantId(51);

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

async function rebuildMemberships(): Promise<void> {
  await rebuildProjection("tenant:projection:tenant-membership-entity", {
    db: stack.db,
    registry: stack.registry,
  });
}

describe("membership streams a replay must not see", () => {
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

    expect(first.rowMissing).toBeUndefined();
    expect(again.id).toBe(first.id);
    expect(again.rowMissing).toBe(true);
    expect(await membershipStreamIds()).toEqual([first.id]);
    await rebuildMemberships();
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
