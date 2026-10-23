import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import type { SessionCreator } from "@cosmicdrift/kumiko-framework/api";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  createLateBoundHolder,
  createTestEnvelopeCipher,
  resetTestTables,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createAuthEmailPasswordFeature } from "../../auth-email-password/feature.ts";
import { AuthHandlers } from "../../auth-email-password/web/constants.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantInvitationEntity } from "../../tenant/invitation-table.ts";
import { tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { TenantQueries } from "../../tenant/web/constants.ts";
import { createUserFeature } from "../../user/feature.ts";
import { userEntity, userTable } from "../../user/schema/user.ts";
import { softDeleteUserViaEventStore } from "../../user/testing-event-store.ts";
import { createSessionsFeature } from "../feature.ts";
import { userSessionEntity, userSessionTable } from "../schema/user-session.ts";
import { createSessionCallbacks, type SessionCallbacks } from "../session-callbacks.ts";
import { sessionCallbacksFromLateBound } from "../testing.ts";
import { makeSessionHelpers } from "./test-helpers.ts";

// Proves the core DoD: a membership role change written through the
// event-store executor takes effect on the very next request made with an
// ALREADY-ISSUED, still-live token — no re-login, no JWT expiry needed.
// Deliberately bypasses update-member-roles.write.ts (which force-revokes
// the session on a role change) so the effect under test isn't masked by
// that unrelated, already-correct revoke-on-change behavior.

let stack: TestStack;
let h: ReturnType<typeof makeSessionHelpers>;
let sessionCreator: SessionCreator;
const callbacks = createLateBoundHolder<SessionCallbacks>("session-callbacks");

const encryptionKey = randomBytes(32).toString("base64");

// Matches TestUsers.systemAdmin.tenantId — same rationale as
// membership-revoke.integration.test.ts.
const TENANT_A: TenantId = testTenantId(1);

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(encryptionKey);
  const resolver = createConfigResolver({ cipher: encryption });
  const bound = sessionCallbacksFromLateBound(callbacks);

  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createAuthEmailPasswordFeature(),
      createAuthFoundationFeature(),
      createSessionsFeature(),
    ],
    extraContext: { configResolver: resolver, configEncryption: encryption },
    authConfig: {
      ...bound.asAuthConfig(),
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
    },
  });
  callbacks.set(createSessionCallbacks({ db: stack.db }));
  const creator = bound.asAuthConfig().sessionCreator;
  if (!creator) throw new Error("sessionCreator missing from bound auth config");
  sessionCreator = creator;
  h = makeSessionHelpers(stack, TENANT_A, sessionCreator);

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tenantInvitationEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
  await unsafeCreateEntityTable(stack.db, userSessionEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [
    userTable,
    tenantMembershipsTable,
    userSessionTable,
    eventsTable,
  ]);
});

describe("sessionChecker re-derives roles from the DB on every request", () => {
  test("a DB-side membership role change unlocks a role-gated action for the SAME live token", async () => {
    // 1. Log in with an initial tenant-membership role set that does NOT
    //    satisfy the admin gate below.
    const { userId } = await h.seedUser("role-upgrade@example.com", "first-password", {
      roles: ["User"],
    });
    const { token } = await h.login("role-upgrade@example.com", "first-password");

    // 2. tenant:query:invitations is gated on access.admin
    //    (["TenantAdmin", "Admin", "SystemAdmin"]) — the freshly-logged-in
    //    "User" role does not satisfy it.
    const before = await h.authedPost("/api/query", token, {
      type: TenantQueries.invitations,
      payload: {},
    });
    expect(before.status).toBe(403);

    // 3. Elevate the role through the event-store executor — explicitly NOT
    //    via update-member-roles.write.ts, whose force-revoke-on-change would
    //    kill the very token this test needs to keep using.
    await h.setMembershipRolesWithoutRevoke(userId, ["Admin"]);

    // 4. Same, still-unrevoked, still-unexpired token — the next request
    //    re-derives roles from the DB and now passes the gate.
    const after = await h.authedPost("/api/query", token, {
      type: TenantQueries.invitations,
      payload: {},
    });
    expect(after.status).toBe(200);
    expect(await after.json()).toEqual({ data: [] });
  });
});

describe("sessionChecker refuses a soft-deleted user", () => {
  test("a live token stops working after executor.delete although the status still reads active", async () => {
    const { userId } = await h.seedUser("soft-deleted@example.com", "first-password", {
      roles: ["Admin"],
    });
    const { token } = await h.login("soft-deleted@example.com", "first-password");
    const before = await h.authedPost("/api/query", token, {
      type: TenantQueries.invitations,
      payload: {},
    });
    expect(before.status).toBe(200);

    await softDeleteUserViaEventStore(stack.db, userId);

    const after = await h.authedPost("/api/query", token, {
      type: TenantQueries.invitations,
      payload: {},
    });
    expect(after.status).toBe(401);
  });
});
