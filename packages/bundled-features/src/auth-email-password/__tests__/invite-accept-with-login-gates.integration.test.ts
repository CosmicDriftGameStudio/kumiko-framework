// invite-accept-with-login used to mint a full session straight off a bare
// verifyPassword call, skipping every gate login.write.ts runs (lockout,
// account-status, MFA). This suite proves the shared gates are wired in:
// an MFA-enrolled invitee gets a challenge instead of a session, and a
// restricted/deleted invitee never gets a session at all.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { configureEntityFieldEncryption } from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { createTestEnvelopeCipher, seedRow } from "@cosmicdrift/kumiko-framework/testing";
import {
  AuthMfaHandlers,
  base32Decode,
  createAuthMfaFeature,
  mfaStatusCheckerFromFeature,
  userMfaEntity,
  userMfaTable,
} from "../../auth-mfa";
import { currentTotpCode } from "../../auth-mfa/totp";
import { createChannelEmailFeature, createInMemoryTransport } from "../../channel-email";
import { createConfigFeature } from "../../config";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createDeliveryFeature, createDeliveryTestContext } from "../../delivery";
import { notificationPreferencesTable } from "../../delivery/tables";
import { createRendererFoundationFeature } from "../../renderer-foundation/feature";
import { createRendererSimpleFeature, simpleRenderer } from "../../renderer-simple";
import { hashPassword } from "../../shared";
import { createTemplateResolverFeature } from "../../template-resolver/feature";
import { createTenantFeature } from "../../tenant";
import { tenantInvitationEntity, tenantInvitationsTable } from "../../tenant/invitation-table";
import { tenantMembershipsTable } from "../../tenant/membership-table";
import { tenantEntity, tenantTable } from "../../tenant/schema/tenant";
import { seedTenant, seedTenantMembership } from "../../tenant/seeding";
import { USER_STATUS } from "../../user";
import { createUserFeature } from "../../user/feature";
import { userEntity, userTable } from "../../user/schema/user";
import { AuthHandlers } from "../constants";
import { createAuthEmailPasswordFeature } from "../feature";

const APP_ACCEPT_URL = "https://app.example.com/invite/accept";
const ALICE_EMAIL = "alice@example.com";

const emailTransport = createInMemoryTransport();

let stack: TestStack;
let aliceId: string;
let TENANT_A_ID: TenantId;

function newTenantId(): TenantId {
  return crypto.randomUUID() as TenantId;
}

function extractTokenFromMail(html: string): string {
  const match = html.match(/[?&]token=([^&"'<\s]+)/);
  if (!match?.[1]) throw new Error(`No token in invite mail html: ${html.slice(0, 200)}`);
  return decodeURIComponent(match[1]);
}

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher();
  configureEntityFieldEncryption(encryption);
  const resolver = createConfigResolver({ cipher: encryption });
  const authMfaFeature = createAuthMfaFeature({
    setupTokenSecret: "test-mfa-setup-token-secret-at-least-32-bytes!!",
    issuer: "Kumiko Test",
    challengeTokenSecret: "test-mfa-challenge-token-secret-at-least-32-bytes!!",
  });

  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createTemplateResolverFeature(),
      createRendererFoundationFeature(),
      createDeliveryFeature(),
      createRendererSimpleFeature(),
      createChannelEmailFeature({
        transport: emailTransport,
        renderer: simpleRenderer,
        resolveEmail: async () => "unused@test.local",
      }),
      authMfaFeature,
      createAuthEmailPasswordFeature({
        invite: { tokenTtlMinutes: 60, appUrl: APP_ACCEPT_URL },
        mfaStatusChecker: mfaStatusCheckerFromFeature(authMfaFeature),
      }),
    ],
    extraContext: (deps) => ({
      ...createDeliveryTestContext(deps),
      configResolver: resolver,
      configEncryption: encryption,
    }),
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
      invite: {
        acceptHandler: AuthHandlers.inviteAccept,
        acceptWithLoginHandler: AuthHandlers.inviteAcceptWithLogin,
        signupCompleteHandler: AuthHandlers.inviteSignupComplete,
      },
    },
  });

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tenantInvitationEntity);
  await unsafeCreateEntityTable(stack.db, userMfaEntity);
  await unsafePushTables(stack.db, {
    configValuesTable,
    tenantMembershipsTable,
    notificationPreferencesTable,
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantMembershipsTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantInvitationsTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userMfaTable.tableName}"`);
  emailTransport.sent.length = 0;
  const allKeys = await stack.redis.redis.keys("invite:*");
  if (allKeys.length > 0) await stack.redis.redis.del(...allKeys);

  TENANT_A_ID = newTenantId();
  await seedTenant(stack.db, {
    id: TENANT_A_ID,
    key: `tenant-a-${TENANT_A_ID.slice(0, 8)}`,
    name: "Tenant A",
  });

  aliceId = crypto.randomUUID();
  await seedRow(stack.db, userTable, {
    id: aliceId,
    tenantId: TENANT_A_ID,
    email: ALICE_EMAIL,
    displayName: "Alice",
    passwordHash: await hashPassword("alice-pw-1234"),
    locale: "de",
    emailVerified: true,
    roles: "[]",
    status: USER_STATUS.Active,
  });
  await seedTenantMembership(stack.db, {
    userId: aliceId,
    tenantId: TENANT_A_ID,
    roles: ["Admin"],
  });
});

function aliceSession(): SessionUser {
  return { id: aliceId, tenantId: TENANT_A_ID, roles: ["Admin"] };
}

// auth-mfa:write:verify runs pre-session (access: { roles: ["all"] }) —
// dispatched here the same way the framework's /api/auth/mfa/verify route
// would, with a guest identity. The handler derives everything it needs
// from the challenge token, not from this actor.
const GUEST: SessionUser = {
  id: "00000000-0000-0000-0000-000000000000",
  tenantId: "00000000-0000-4000-8000-000000000000" as TenantId,
  roles: ["all"],
};

async function inviteEmail(email: string, role: string): Promise<string> {
  await stack.http.writeOk(AuthHandlers.inviteCreate, { email, role }, aliceSession());
  const sent = emailTransport.sent.at(-1);
  if (!sent) throw new Error("invite-create didn't send a mail");
  return extractTokenFromMail(sent.html);
}

describe("invite-accept-with-login: MFA gate", () => {
  test("an MFA-enrolled invitee gets an mfa-challenge, not a session", async () => {
    const email = "mfa-invitee@example.com";
    const password = "mfa-invitee-pw-1234";

    // Enroll MFA for this user in TENANT_A BEFORE they're invited — userMfaEntity
    // rows are keyed (userId, tenantId), so enrollment must target the tenant
    // the invite will later grant membership in.
    const mfaActor = createTestUser({ id: 701, tenantId: TENANT_A_ID, roles: ["User"] });
    const start = await stack.http.writeOk<{ setupToken: string; otpauthUri: string }>(
      AuthMfaHandlers.enableStart,
      { accountLabel: email },
      mfaActor,
    );
    const secretParam = new URLSearchParams(start.otpauthUri.split("?")[1]).get("secret") ?? "";
    const secret = base32Decode(secretParam);
    await stack.http.writeOk(
      AuthMfaHandlers.enableConfirm,
      { setupToken: start.setupToken, code: currentTotpCode(secret) },
      mfaActor,
    );

    // Real user row matching the synthetic actor's id — invite-accept-with-login
    // reads this row for password/status, gateEnforceMfa reads userMfaEntity
    // by (mfaActor.id, TENANT_A_ID).
    await seedRow(stack.db, userTable, {
      id: mfaActor.id,
      tenantId: TENANT_A_ID,
      email,
      passwordHash: await hashPassword(password),
      displayName: "MFA Invitee",
      locale: "de",
      emailVerified: true,
      roles: "[]",
      status: USER_STATUS.Active,
    });

    const token = await inviteEmail(email, "Editor");
    const res = await stack.http.raw("POST", "/api/auth/invite-accept-with-login", {
      token,
      email,
      password,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      isSuccess: boolean;
      mfaRequired?: boolean;
      challengeToken?: string;
      token?: string;
    };
    expect(body.isSuccess).toBe(true);
    expect(body.mfaRequired).toBe(true);
    expect(typeof body.challengeToken).toBe("string");
    // No session — a challenge, not a JWT.
    expect(body.token).toBeUndefined();
  });

  // fw#2333 — completing the challenge via auth-mfa:write:verify must carry
  // the invitee's locale into the minted session, same as a plain login.
  async function acceptWithLoginThenVerifyMfa(opts: {
    actorId: number;
    email: string;
    password: string;
    locale?: string;
  }): Promise<SessionUser> {
    const mfaActor = createTestUser({ id: opts.actorId, tenantId: TENANT_A_ID, roles: ["User"] });
    const start = await stack.http.writeOk<{ setupToken: string; otpauthUri: string }>(
      AuthMfaHandlers.enableStart,
      { accountLabel: opts.email },
      mfaActor,
    );
    const secretParam = new URLSearchParams(start.otpauthUri.split("?")[1]).get("secret") ?? "";
    const secret = base32Decode(secretParam);
    await stack.http.writeOk(
      AuthMfaHandlers.enableConfirm,
      { setupToken: start.setupToken, code: currentTotpCode(secret) },
      mfaActor,
    );

    await seedRow(stack.db, userTable, {
      id: mfaActor.id,
      tenantId: TENANT_A_ID,
      email: opts.email,
      passwordHash: await hashPassword(opts.password),
      displayName: "MFA Invitee",
      ...(opts.locale !== undefined && { locale: opts.locale }),
      emailVerified: true,
      roles: "[]",
      status: USER_STATUS.Active,
    });

    const token = await inviteEmail(opts.email, "Editor");
    const acceptRes = await stack.http.raw("POST", "/api/auth/invite-accept-with-login", {
      token,
      email: opts.email,
      password: opts.password,
    });
    expect(acceptRes.status).toBe(200);
    const acceptBody = (await acceptRes.json()) as { challengeToken?: string };
    if (!acceptBody.challengeToken) {
      throw new Error("invite-accept-with-login did not return a challenge token");
    }

    const verified = await stack.http.writeOk<{ session: SessionUser }>(
      AuthMfaHandlers.verify,
      { challengeToken: acceptBody.challengeToken, code: currentTotpCode(secret) },
      GUEST,
    );
    return verified.session;
  }

  test("completing the mfa/verify challenge carries the invitee's locale into the session", async () => {
    const session = await acceptWithLoginThenVerifyMfa({
      actorId: 702,
      email: "mfa-locale-invitee@example.com",
      password: "mfa-locale-invitee-pw-1234",
      locale: "de-DE",
    });
    expect(session.locale).toBe("de-DE");
  });

  test("completing the mfa/verify challenge without a stored locale omits the claim", async () => {
    const session = await acceptWithLoginThenVerifyMfa({
      actorId: 703,
      email: "mfa-nolocale-invitee@example.com",
      password: "mfa-nolocale-invitee-pw-1234",
    });
    expect(session.locale).toBeUndefined();
  });
});

describe("invite-accept-with-login: account-status gate", () => {
  test("a Restricted invitee is refused — no session minted", async () => {
    const email = "restricted-invitee@example.com";
    const password = "restricted-invitee-pw-1234";
    const userId = crypto.randomUUID();

    await seedRow(stack.db, userTable, {
      id: userId,
      tenantId: TENANT_A_ID,
      email,
      passwordHash: await hashPassword(password),
      displayName: "Restricted Invitee",
      locale: "de",
      emailVerified: true,
      roles: "[]",
      status: USER_STATUS.Active,
    });
    await asRawClient(stack.db).unsafe(
      `UPDATE "${userTable.tableName}" SET status = $1 WHERE id = $2`,
      [USER_STATUS.Restricted, userId],
    );

    const token = await inviteEmail(email, "Editor");
    const res = await stack.http.raw("POST", "/api/auth/invite-accept-with-login", {
      token,
      email,
      password,
    });

    expect(res.status).not.toBe(200);
    const body = (await res.json()) as { isSuccess: boolean; token?: string };
    expect(body.isSuccess).toBe(false);
    expect(body.token).toBeUndefined();

    const memberships = await selectMany(stack.db, tenantMembershipsTable, { userId });
    expect(memberships).toHaveLength(0);
  });
});
