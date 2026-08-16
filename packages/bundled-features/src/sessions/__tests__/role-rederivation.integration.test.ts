import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { authFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import type { SessionCreator } from "@cosmicdrift/kumiko-framework/api";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  createLateBoundHolder,
  createTestEnvelopeCipher,
  updateRows,
} from "@cosmicdrift/kumiko-framework/testing";
import { AuthHandlers } from "../../auth-email-password/constants";
import { createAuthEmailPasswordFeature } from "../../auth-email-password/feature";
import { createConfigFeature } from "../../config";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { TenantQueries } from "../../tenant/constants";
import { createTenantFeature } from "../../tenant/feature";
import { tenantInvitationEntity } from "../../tenant/invitation-table";
import { tenantMembershipsTable } from "../../tenant/membership-table";
import { tenantEntity } from "../../tenant/schema/tenant";
import { createUserFeature } from "../../user/feature";
import { userEntity, userTable } from "../../user/schema/user";
import { createSessionsFeature } from "../feature";
import { userSessionEntity, userSessionTable } from "../schema/user-session";
import { createSessionCallbacks, type SessionCallbacks } from "../session-callbacks";
import { sessionCallbacksFromLateBound } from "../testing";
import { makeSessionHelpers } from "./test-helpers";

// Proves the core DoD of #2148: a role change written directly to
// tenantMembershipsTable takes effect on the very next request made with an
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
      authFoundationFeature,
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
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantMembershipsTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userSessionTable.tableName}"`);
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

    // 3. Elevate the role by writing DIRECTLY to tenantMembershipsTable —
    //    explicitly NOT via update-member-roles.write.ts, whose
    //    force-revoke-on-change would kill the very token this test needs
    //    to keep using.
    await updateRows(
      stack.db,
      tenantMembershipsTable,
      { roles: JSON.stringify(["Admin"]) },
      { userId, tenantId: TENANT_A },
    );

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
