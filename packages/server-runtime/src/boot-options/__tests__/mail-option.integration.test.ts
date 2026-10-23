import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  tenantMembershipEntity,
  tenantMembershipsTable,
} from "@cosmicdrift/kumiko-bundled-features/tenant";
import {
  createUserFeature,
  userEntity,
  userTable,
} from "@cosmicdrift/kumiko-bundled-features/user";
import {
  defineFeature,
  defineWriteHandler,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { resetTestTables, seedRow } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { type MailRecipientScope, resolveStoredUserEmail } from "../mail-option.ts";

const RESOLVE = "mail-probe:write:resolve";
const TENANT_A = testTenantId(1);
const TENANT_B = testTenantId(2);

const MEMBER_ID = "11111111-1111-4111-8111-111111111111";
const OUTSIDER_ID = "22222222-2222-4222-8222-222222222222";
const SYSADMIN_ID = "33333333-3333-4333-8333-333333333333";
const SYSTEM_USER_ID = "44444444-4444-4444-8444-444444444444";

// Runs the default resolver inside a real handler: ctx.db is the tenant-scoped
// connection the email channel hands to resolveEmail.
const mailProbeFeature = defineFeature("mail-probe", (r) => {
  r.writeHandler(
    defineWriteHandler({
      name: "resolve",
      schema: z.object({
        userId: z.string(),
        scope: z.enum(["membership", "any"]).optional(),
      }),
      access: { openToAll: { reason: "test probe" } },
      handler: async (event, ctx) => {
        const scope: MailRecipientScope | undefined = event.payload.scope;
        const email = await resolveStoredUserEmail(
          event.payload.userId,
          { db: ctx.db, tenantId: event.user.tenantId },
          scope,
        );
        return { isSuccess: true as const, data: { email } };
      },
    }),
  );
});

let stack: TestStack;
const caller = createTestUser({ id: 9, tenantId: TENANT_A, roles: ["Member"] });
const systemCaller = createTestUser({ id: 10, tenantId: SYSTEM_TENANT_ID, roles: ["Member"] });

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createUserFeature(), mailProbeFeature],
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantMembershipEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

async function seedUser(id: string, roles: string): Promise<void> {
  await seedRow(stack.db, userTable, {
    id,
    tenantId: SYSTEM_TENANT_ID,
    email: `${id}@example.com`,
    passwordHash: "hashed",
    displayName: id,
    locale: "de",
    emailVerified: true,
    roles,
    status: "active",
  });
}

beforeEach(async () => {
  await resetTestTables(stack.db, [userTable, "read_tenant_memberships", eventsTable]);
  await seedUser(MEMBER_ID, '["Member"]');
  await seedUser(OUTSIDER_ID, '["Member"]');
  await seedUser(SYSADMIN_ID, '["SystemAdmin"]');
  await seedUser(SYSTEM_USER_ID, '["Member"]');
  await seedRow(stack.db, tenantMembershipsTable, {
    tenantId: TENANT_A,
    userId: MEMBER_ID,
    roles: '["Member"]',
  });
  // A membership in another tenant must not open tenant A to the user.
  await seedRow(stack.db, tenantMembershipsTable, {
    tenantId: TENANT_B,
    userId: OUTSIDER_ID,
    roles: '["Member"]',
  });
});

async function resolve(
  userId: string,
  options: { as?: typeof caller; scope?: MailRecipientScope } = {},
): Promise<string | null> {
  const result = await stack.http.writeOk<{ email: string | null }>(
    RESOLVE,
    { userId, ...(options.scope && { scope: options.scope }) },
    options.as ?? caller,
  );
  return result.email;
}

describe("default resolveEmail", () => {
  test("a member of the notifying tenant is reachable", async () => {
    expect(await resolve(MEMBER_ID)).toBe(`${MEMBER_ID}@example.com`);
  });

  test("a user who is only a member of another tenant is not", async () => {
    expect(await resolve(OUTSIDER_ID)).toBeNull();
  });

  test("an unknown user id resolves to null", async () => {
    expect(await resolve("55555555-5555-4555-8555-555555555555")).toBeNull();
  });

  test("a SystemAdmin without membership is reachable from any tenant", async () => {
    expect(await resolve(SYSADMIN_ID)).toBe(`${SYSADMIN_ID}@example.com`);
  });

  test("the system tenant reaches every user", async () => {
    expect(await resolve(OUTSIDER_ID, { as: systemCaller })).toBe(`${OUTSIDER_ID}@example.com`);
  });

  test('recipientScope "any" reaches a non-member', async () => {
    expect(await resolve(OUTSIDER_ID, { scope: "any" })).toBe(`${OUTSIDER_ID}@example.com`);
  });
});
