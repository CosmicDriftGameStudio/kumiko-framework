// remove-member and update-member-roles answer with their own flat payload, yet the membership
// save/delete still has to reach postSave/postDelete hooks (withResponseData keeps the lifecycle).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
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
import { seedUser } from "../../user/seeding.ts";
import { createTenantFeature } from "../feature.ts";
import { tenantMembershipsTable } from "../membership-table.ts";
import { tenantEntity, tenantTable } from "../schema/tenant.ts";
import { seedTenantMembership } from "../seeding.ts";
import { TenantHandlers } from "../web/constants.ts";

const TENANT = testTenantId(61);
const seenSaves: string[] = [];
const seenDeletes: string[] = [];

const probe = defineFeature("membership-probe", (r) => {
  r.requires({ features: ["tenant"] });
  r.hook({
    type: "postSave",
    target: { allOf: "tenant-membership" },
    handler: async (result) => {
      seenSaves.push(String(result.id));
    },
  });
  r.hook({
    type: "postDelete",
    target: { allOf: "tenant-membership" },
    handler: async (result) => {
      seenDeletes.push(String(result.id));
    },
  });
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createConfigFeature(), createUserFeature(), createTenantFeature(), probe],
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
});

beforeEach(async () => {
  seenSaves.length = 0;
  seenDeletes.length = 0;
  await resetTestTables(stack.db, [userTable, tenantMembershipsTable, tenantTable, eventsTable]);
});

afterAll(() => stack.cleanup());

async function seedMember(): Promise<string> {
  const { id } = await seedUser(stack.db, {
    email: "member@example.com",
    displayName: "Member",
    passwordHash: "x",
    emailVerified: true,
  });
  await seedTenantMembership(stack.db, { userId: id, tenantId: TENANT, roles: ["Member"] });
  return id;
}

describe("tenant membership write handlers keep their lifecycle", () => {
  test("update-member-roles returns its flat payload and fires postSave", async () => {
    const userId = await seedMember();
    const res = await stack.http.writeOk<Record<string, unknown>>(
      TenantHandlers.updateMemberRoles,
      { userId, tenantId: TENANT, roles: ["Admin"] },
      TestUsers.systemAdmin,
    );
    expect(res).toMatchObject({ userId, roles: ["Admin"] });
    expect(res).not.toHaveProperty("kind");
    expect(res).not.toHaveProperty("lifecycle");
    expect(seenSaves).toHaveLength(1);
  });

  test("remove-member returns its flat payload and fires postDelete", async () => {
    const userId = await seedMember();
    const res = await stack.http.writeOk<Record<string, unknown>>(
      TenantHandlers.removeMember,
      { userId, tenantId: TENANT },
      TestUsers.systemAdmin,
    );
    expect(res).toMatchObject({ userId, tenantId: TENANT });
    expect(res).not.toHaveProperty("kind");
    expect(res).not.toHaveProperty("lifecycle");
    expect(seenDeletes).toHaveLength(1);
  });
});
