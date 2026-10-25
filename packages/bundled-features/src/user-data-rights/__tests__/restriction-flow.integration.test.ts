// GDPR Art. 18 account freeze: end-to-end test across three
// features (sessions + auth-email-password + user-data-rights):
//
//   - restrict-account changes the status and revokes all sessions across features
//   - lift-restriction changes it back
//   - The login path blocks Restricted with its own error code and collapses
//     DeletionRequested/Deleted to invalid_credentials (anti-enumeration)
//   - Existing JWTs for a restricted user are rejected by sessionChecker
//     because session revocation takes effect
//   - State-transition matrix: Active↔Restricted; other transitions fail
//     with clear error codes

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
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
import { AuthErrors, AuthHandlers } from "../../auth-email-password/web/constants.ts";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "../../compliance-profiles/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { createDataRetentionFeature } from "../../data-retention/index.ts";
import { SessionHandlers } from "../../sessions/constants.ts";
import { createSessionsFeature } from "../../sessions/index.ts";
import { userSessionEntity, userSessionTable } from "../../sessions/schema/user-session.ts";
import { createSessionCallbacks, type SessionCallbacks } from "../../sessions/session-callbacks.ts";
import {
  SESSION_REVOKED_EVENT_QN,
  sessionRevokedSchema,
} from "../../sessions/session-revoked-event.ts";
import { sessionCallbacksFromLateBound, withMintedSession } from "../../sessions/testing.ts";
import { hashPassword } from "../../shared/index.ts";
import { createTenantFeature, tenantMembershipsTable } from "../../tenant/index.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { seedTenantMembership } from "../../tenant/seeding.ts";
import { createUserFeature, USER_STATUS, userEntity, userTable } from "../../user/index.ts";
import { updateUserViaEventStore } from "../../user/testing.ts";
import { UserHandlers } from "../../user/web/constants.ts";
import { createUserDataRightsFeature } from "../feature.ts";

const RESTRICT = "user-data-rights:write:restrict-account";
const LIFT = "user-data-rights:write:lift-restriction";

let stack: TestStack;
const callbacks = createLateBoundHolder<SessionCallbacks>("session-callbacks");
const encryptionKey = randomBytes(32).toString("base64");
const TENANT: TenantId = testTenantId(1);

const ALICE_EMAIL = "alice.restrict@example.com";
const ALICE_PW = "alice-pw-long-enough";

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(encryptionKey);
  const resolver = createConfigResolver({ cipher: encryption });
  const bound = sessionCallbacksFromLateBound(callbacks);

  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createAuthEmailPasswordFeature(),
      createAuthFoundationFeature(),
      createSessionsFeature(),
      createUserDataRightsFeature(),
    ],
    extraContext: { configResolver: resolver, configEncryption: encryption },
    authConfig: {
      ...bound.asAuthConfig(),
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
    },
  });
  callbacks.set(createSessionCallbacks({ db: stack.db }));

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, userSessionEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [
    userSessionTable,
    userTable,
    tenantMembershipsTable,
    tenantComplianceProfileTable,
    eventsTable,
  ]);
});

async function seedAliceWithMembership(
  status: string = USER_STATUS.Active,
): Promise<{ userId: string }> {
  const hash = await hashPassword(ALICE_PW);
  const actor = await withMintedSession(
    (user, meta) => callbacks.get().sessionCreator(user, meta),
    TestUsers.systemAdmin,
  );
  const created = await stack.http.writeOk<{ id: string }>(
    UserHandlers.create,
    { email: ALICE_EMAIL, passwordHash: hash, displayName: "Alice" },
    actor,
  );
  if (status !== USER_STATUS.Active) {
    await updateUserViaEventStore(stack.db, created.id, { status });
  }
  await seedTenantMembership(stack.db, {
    userId: created.id,
    tenantId: TENANT,
    roles: ["Member"],
  });
  return { userId: created.id };
}

async function login(email: string, password: string): Promise<{ status: number; body: unknown }> {
  const res = await stack.http.raw("POST", "/api/auth/login", { email, password });
  return { status: res.status, body: await res.json() };
}

// Any actor hitting a write handler needs a live sid once sessionChecker
// is wired (same gate as seedAliceWithMembership's bootstrap actor above).
function mintActor(user: { id: string; tenantId: TenantId; roles: readonly string[] }) {
  return withMintedSession((u, meta) => callbacks.get().sessionCreator(u, meta), user);
}

function reasonOf(err: { details?: unknown }): string | undefined {
  return (err.details as { reason?: string } | undefined)?.reason;
}

describe("S2.U6 :: restrict-account state-transitions", () => {
  test("Active → Restricted: status flippt + alle Sessions revoked", async () => {
    const { userId } = await seedAliceWithMembership();
    // Log in to create a session.
    const loginRes = await login(ALICE_EMAIL, ALICE_PW);
    expect(loginRes.status).toBe(200);

    // Session-Row vorhanden + live (revokedAt=null).
    const sessionsBefore = (await selectMany(stack.db, userSessionTable, { userId })) as Array<{
      id: string;
      revokedAt: unknown;
    }>;
    expect(sessionsBefore.length).toBeGreaterThanOrEqual(1);
    expect(sessionsBefore.every((s) => s.revokedAt === null)).toBe(true);

    // Restrict-Account.
    const aliceUser = await mintActor({
      id: userId,
      tenantId: TENANT,
      roles: ["Member"],
    });
    const result = await stack.http.writeOk<{ userId: string; status: string }>(
      RESTRICT,
      {},
      aliceUser,
    );
    expect(result.status).toBe(USER_STATUS.Restricted);
    expect(result.userId).toBe(userId);

    // DB-State: status=Restricted.
    const userRow = (await selectMany(stack.db, userTable, { id: userId })) as Array<{
      status: string;
    }>;
    expect(userRow[0]?.status).toBe(USER_STATUS.Restricted);

    // Alle Sessions revoked (revokedAt != null).
    const sessionsAfter = (await selectMany(stack.db, userSessionTable, { userId })) as Array<{
      revokedAt: unknown;
    }>;
    expect(sessionsAfter.every((s) => s.revokedAt !== null)).toBe(true);
  });

  test("non-admin targets another user's account: 403 admin_required_for_other_user", async () => {
    const { userId: targetId } = await seedAliceWithMembership();
    const attacker = await mintActor({
      id: crypto.randomUUID(),
      tenantId: TENANT,
      roles: ["Member"],
    });
    const err = await stack.http.writeErr(RESTRICT, { userId: targetId }, attacker);
    expect(err.httpStatus).toBe(403);
    expect(reasonOf(err)).toBe("admin_required_for_other_user");

    const userRow = (await selectMany(stack.db, userTable, { id: targetId })) as Array<{
      status: string;
    }>;
    expect(userRow[0]?.status).toBe(USER_STATUS.Active);
  });

  // Mirrors the lift-restriction cross-tenant guard
  // below — an isAdminActor check alone lets an Admin/TenantAdmin from a
  // DIFFERENT tenant restrict (and force-revoke the sessions of) a user
  // who was never a member of the admin's tenant.
  test("Admin from another tenant: 403 target_user_not_in_admin_tenant, status remains Active", async () => {
    const { userId } = await seedAliceWithMembership();
    const otherTenantAdmin = await mintActor(TestUsers.otherTenant);

    const err = await stack.http.writeErr(RESTRICT, { userId }, otherTenantAdmin);
    expect(err.httpStatus).toBe(403);
    expect(reasonOf(err)).toBe("target_user_not_in_admin_tenant");

    const userRow = (await selectMany(stack.db, userTable, { id: userId })) as Array<{
      status: string;
    }>;
    expect(userRow[0]?.status).toBe(USER_STATUS.Active);
  });

  test("SystemAdmin can restrict across tenants (platform-wide operator)", async () => {
    const { userId } = await seedAliceWithMembership();
    const systemAdmin = await mintActor({
      id: crypto.randomUUID(),
      tenantId: testTenantId(2),
      roles: ["SystemAdmin"],
    });

    const result = await stack.http.writeOk<{ status: string }>(RESTRICT, { userId }, systemAdmin);
    expect(result.status).toBe(USER_STATUS.Restricted);
  });

  test("Restricted → Restricted (Idempotenz-Guard): 422 already_restricted", async () => {
    const { userId } = await seedAliceWithMembership(USER_STATUS.Restricted);
    // Alice's own session is blocked while Restricted — an admin targets
    // her account instead, same as production would have to.
    const admin = await mintActor(TestUsers.admin);
    const err = await stack.http.writeErr(RESTRICT, { userId }, admin);
    expect(err.httpStatus).toBe(422);
    expect(reasonOf(err)).toBe("already_restricted");
  });

  test("DeletionRequested → restrict-account: 422 user_not_in_active_state", async () => {
    const { userId } = await seedAliceWithMembership(USER_STATUS.DeletionRequested);
    const aliceUser = await mintActor({ id: userId, tenantId: TENANT, roles: ["Member"] });
    const err = await stack.http.writeErr(RESTRICT, {}, aliceUser);
    expect(reasonOf(err)).toBe("user_not_in_active_state");
  });

  // access.admin includes TenantAdmin/Admin, which
  // are tenant-scoped roles, but the User-entity lookup uses ctx.db.raw
  // (no auto-tenant-filter — User status is intentionally global). Without
  // a membership check, an Admin from a DIFFERENT tenant than the target
  // user could still pass the isAdminActor gate and flip the target's
  // status.
  test("Admin from another tenant: 403 target_user_not_in_admin_tenant, status remains Active", async () => {
    const { userId: targetId } = await seedAliceWithMembership();
    const otherTenantAdmin = await mintActor(TestUsers.otherTenant);

    const err = await stack.http.writeErr(RESTRICT, { userId: targetId }, otherTenantAdmin);
    expect(err.httpStatus).toBe(403);
    expect(reasonOf(err)).toBe("target_user_not_in_admin_tenant");

    const userRow = (await selectMany(stack.db, userTable, { id: targetId })) as Array<{
      status: string;
    }>;
    expect(userRow[0]?.status).toBe(USER_STATUS.Active);
  });

  test("SystemAdmin can restrict across tenants (platform-wide operator) + revoked sessions", async () => {
    const { userId: targetId } = await seedAliceWithMembership();
    const loginRes = await login(ALICE_EMAIL, ALICE_PW);
    expect(loginRes.status).toBe(200);

    const systemAdmin = await mintActor({
      id: crypto.randomUUID(),
      tenantId: testTenantId(2),
      roles: ["SystemAdmin"],
    });

    const result = await stack.http.writeOk<{ userId: string; status: string }>(
      RESTRICT,
      { userId: targetId },
      systemAdmin,
    );
    expect(result.status).toBe(USER_STATUS.Restricted);

    const sessionsAfter = (await selectMany(stack.db, userSessionTable, {
      userId: targetId,
    })) as Array<{ revokedAt: unknown }>;
    expect(sessionsAfter.length).toBeGreaterThanOrEqual(1);
    expect(sessionsAfter.every((s) => s.revokedAt !== null)).toBe(true);
  });
});

describe("S2.U6 :: lift-restriction state-transitions", () => {
  test("Restricted → Active: status flippt zurueck", async () => {
    const { userId } = await seedAliceWithMembership(USER_STATUS.Restricted);
    // lift-restriction is operator-only (access.admin) — Alice's own
    // session is blocked while Restricted anyway.
    const admin = await mintActor(TestUsers.admin);

    const result = await stack.http.writeOk<{ status: string }>(LIFT, { userId }, admin);
    expect(result.status).toBe(USER_STATUS.Active);

    const userRow = (await selectMany(stack.db, userTable, { id: userId })) as Array<{
      status: string;
    }>;
    expect(userRow[0]?.status).toBe(USER_STATUS.Active);
  });

  test("Active → lift-restriction: 422 not_restricted (Idempotenz-Guard)", async () => {
    const { userId } = await seedAliceWithMembership(USER_STATUS.Active);
    const admin = await mintActor(TestUsers.admin);
    const err = await stack.http.writeErr(LIFT, { userId }, admin);
    expect(reasonOf(err)).toBe("not_restricted");
  });

  test("DeletionRequested → lift-restriction: 422 not_restricted", async () => {
    const { userId } = await seedAliceWithMembership(USER_STATUS.DeletionRequested);
    const admin = await mintActor(TestUsers.admin);
    const err = await stack.http.writeErr(LIFT, { userId }, admin);
    expect(reasonOf(err)).toBe("not_restricted");
  });

  // access.admin includes TenantAdmin/Admin, which
  // are tenant-scoped roles, but the User-entity lookup uses ctx.db.raw
  // (no auto-tenant-filter — User status is intentionally global). Without
  // a membership check, an Admin from a DIFFERENT tenant than the target
  // user could still pass the access-gate and flip the target's status.
  test("Admin from another tenant: 403 target_user_not_in_admin_tenant, status remains Restricted", async () => {
    const { userId } = await seedAliceWithMembership(USER_STATUS.Restricted);
    const otherTenantAdmin = await mintActor(TestUsers.otherTenant);

    const err = await stack.http.writeErr(LIFT, { userId }, otherTenantAdmin);
    expect(err.httpStatus).toBe(403);
    expect(reasonOf(err)).toBe("target_user_not_in_admin_tenant");

    const userRow = (await selectMany(stack.db, userTable, { id: userId })) as Array<{
      status: string;
    }>;
    expect(userRow[0]?.status).toBe(USER_STATUS.Restricted);
  });

  test("SystemAdmin can lift across tenants (platform-wide operator)", async () => {
    const { userId } = await seedAliceWithMembership(USER_STATUS.Restricted);
    const systemAdmin = await mintActor({
      id: crypto.randomUUID(),
      tenantId: testTenantId(2),
      roles: ["SystemAdmin"],
    });

    const result = await stack.http.writeOk<{ status: string }>(LIFT, { userId }, systemAdmin);
    expect(result.status).toBe(USER_STATUS.Active);
  });
});

describe("Login block for Restricted/DeletionRequested/Deleted", () => {
  test("Active user login: 200 (regression check)", async () => {
    await seedAliceWithMembership(USER_STATUS.Active);
    const res = await login(ALICE_EMAIL, ALICE_PW);
    expect(res.status).toBe(200);
  });

  test("Restricted user login: 422 account_restricted (own code, no collapse)", async () => {
    await seedAliceWithMembership(USER_STATUS.Restricted);
    const res = await login(ALICE_EMAIL, ALICE_PW);
    expect(res.status).toBe(422);
    const body = res.body as { error?: { details?: { reason?: string } } };
    expect(body.error?.details?.reason).toBe(AuthErrors.accountRestricted);
  });

  test("DeletionRequested user login: 422 invalid_credentials (anti-enum collapse)", async () => {
    await seedAliceWithMembership(USER_STATUS.DeletionRequested);
    const res = await login(ALICE_EMAIL, ALICE_PW);
    expect(res.status).toBe(422);
    const body = res.body as { error?: { details?: { reason?: string } } };
    expect(body.error?.details?.reason).toBe(AuthErrors.invalidCredentials);
  });

  test("Deleted user login: 422 invalid_credentials (anti-enum collapse)", async () => {
    await seedAliceWithMembership(USER_STATUS.Deleted);
    const res = await login(ALICE_EMAIL, ALICE_PW);
    expect(res.status).toBe(422);
    const body = res.body as { error?: { details?: { reason?: string } } };
    expect(body.error?.details?.reason).toBe(AuthErrors.invalidCredentials);
  });

  test("Wrong password before status check (timing equivalence): 422 invalid_credentials, NOT account_restricted", async () => {
    // A Restricted user with a WRONG password must NOT learn account_restricted:
    // invalid_credentials is returned first (see login.write.ts: the status
    // check occurs AFTER password-verify). Otherwise, an attacker without
    // valid credentials could enumerate the Restricted status.
    await seedAliceWithMembership(USER_STATUS.Restricted);
    const res = await login(ALICE_EMAIL, "wrong-password-here");
    expect(res.status).toBe(422);
    const body = res.body as { error?: { details?: { reason?: string } } };
    expect(body.error?.details?.reason).toBe(AuthErrors.invalidCredentials);
  });
});

describe("S2.U6 :: Cross-Feature sessions.revokeAllForUser direct", () => {
  test("Privileged revoke-all-for-user with no live sessions emits no event", async () => {
    const { userId } = await seedAliceWithMembership();
    const systemUser = await mintActor({
      id: "00000000-0000-4000-8000-000000000000",
      tenantId: TENANT,
      roles: ["SystemAdmin"],
    });

    const result = await stack.http.writeOk<{ count: number; userId: string }>(
      SessionHandlers.revokeAllForUser,
      { userId },
      systemUser,
    );
    expect(result.count).toBe(0);
    expect(result.userId).toBe(userId);

    const events = await selectMany(stack.db, eventsTable, { type: SESSION_REVOKED_EVENT_QN });
    expect(events).toHaveLength(0);
  });

  test("Privileged-Caller revoked alle live sessions eines Users", async () => {
    const { userId } = await seedAliceWithMembership();
    // 2 Sessions erzeugen via Login + zweiter Login.
    const a = await login(ALICE_EMAIL, ALICE_PW);
    const b = await login(ALICE_EMAIL, ALICE_PW);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const liveBefore = (await selectMany(stack.db, userSessionTable, { userId })) as Array<{
      id: string;
    }>;
    expect(liveBefore.length).toBe(2);

    // System-Caller.
    const systemUser = await mintActor({
      id: "00000000-0000-4000-8000-000000000000",
      tenantId: TENANT,
      roles: ["SystemAdmin"],
    });
    const result = await stack.http.writeOk<{ count: number; userId: string }>(
      SessionHandlers.revokeAllForUser,
      { userId },
      systemUser,
    );
    expect(result.count).toBe(2);
    expect(result.userId).toBe(userId);

    // Alle revoked.
    const revoked = (await selectMany(stack.db, userSessionTable, { userId })) as Array<{
      revokedAt: unknown;
    }>;
    expect(revoked.every((s) => s.revokedAt !== null)).toBe(true);

    // Cross-tenant privileged revoke uses the low-level append(),
    // not ctx.events.unsafeAppend (see revoke-all-for-user.write.ts for why:
    // the SystemAdmin caller's own tenantId has no relationship to the
    // target user's session tenant). One event, both sids listed.
    const events = await selectMany(stack.db, eventsTable, { type: SESSION_REVOKED_EVENT_QN });
    expect(events).toHaveLength(1);
    const payload = sessionRevokedSchema.parse(events[0]?.["payload"]);
    expect(payload.userId).toBe(userId);
    expect(new Set(payload.sessionIds)).toEqual(new Set(liveBefore.map((s) => s.id)));
  });
});
