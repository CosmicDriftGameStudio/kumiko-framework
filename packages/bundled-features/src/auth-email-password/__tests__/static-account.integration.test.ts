import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  type SessionUser,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { registerMailTranslations } from "@cosmicdrift/kumiko-framework/i18n";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { localeDeBundle } from "@cosmicdrift/kumiko-locale-de";
import {
  createLateBoundHolder,
  createTestEnvelopeCipher,
  getSetCookieValue,
  resetTestTables,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createChannelEmailFeature, createInMemoryTransport } from "../../channel-email/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { createDeliveryFeature, createDeliveryTestContext } from "../../delivery/index.ts";
import { notificationPreferencesTable } from "../../delivery/tables.ts";
import { createSessionsFeature, userSessionTable } from "../../sessions/index.ts";
import { createSessionCallbacks, type SessionCallbacks } from "../../sessions/session-callbacks.ts";
import { sessionCallbacksFromLateBound, withMintedSession } from "../../sessions/testing.ts";
import {
  type BrowserSession,
  restoreFetch,
  routeFetchToStack,
} from "../../shared/__tests__/fetch-test-utils.ts";
import { hashPassword } from "../../shared/index.ts";
import { createTenantFeature, TenantHandlers } from "../../tenant/index.ts";
import { tenantInvitationEntity, tenantInvitationsTable } from "../../tenant/invitation-table.ts";
import { tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { tenantEntity, tenantTable } from "../../tenant/schema/tenant.ts";
import { seedTenantMembership } from "../../tenant/testing.ts";
import { createUserFeature } from "../../user/feature.ts";
import { UserHandlers } from "../../user/index.ts";
import { userEntity, userTable } from "../../user/schema/user.ts";
import { createAuthEmailPasswordFeature } from "../feature.ts";
import { getLockoutState } from "../lockout-store.ts";
import { signVerificationToken } from "../verification-token.ts";
import { AuthHandlers, AuthQueries } from "../web/constants.ts";
import {
  acceptInviteSignedIn,
  acceptInviteWithNewAccount,
  confirmAccountUnlock,
  fetchInviteInfo,
  fetchSignupRegistrationStatus,
  logout,
  requestAccountUnlock,
  requestPasswordReset,
  resetPassword,
  verifyEmail,
} from "../web/static-account.ts";
import { authMailRendererFeatures, seedAuthMailTemplates } from "./auth-mail-stack.ts";

registerMailTranslations("de", localeDeBundle);

const emailTransport = createInMemoryTransport();
const VERIFY_SECRET = randomBytes(32).toString("base64");
const UNLOCK_SECRET = randomBytes(32).toString("base64");
const NEW_PASSWORD = "static-account-pw-1234";
const TENANT_ID = "00000000-0000-4000-8000-0000000000a1" as TenantId;

let stack: TestStack;
const sessionCallbacks = createLateBoundHolder<SessionCallbacks>("session-callbacks");

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      ...authMailRendererFeatures(),
      createDeliveryFeature(),
      createChannelEmailFeature({
        transport: emailTransport,
        resolveEmail: async () => "unused@test.local",
      }),
      createAuthEmailPasswordFeature({
        passwordReset: {
          hmacSecret: randomBytes(32).toString("base64"),
          tokenTtlMinutes: 15,
          appUrl: "https://app.example.com/reset",
        },
        accountLockout: { maxFailedAttempts: 3, lockoutDurationMinutes: 1 },
        accountUnlock: {
          hmacSecret: UNLOCK_SECRET,
          tokenTtlMinutes: 15,
          appUrl: "https://app.example.com/unlock-account",
        },
        emailVerification: {
          hmacSecret: VERIFY_SECRET,
          tokenTtlMinutes: 60,
          mode: "strict",
          appUrl: "https://app.example.com/verify",
        },
        invite: { tokenTtlMinutes: 60, appUrl: "https://app.example.com/invite/accept" },
        signup: { tokenTtlMinutes: 60, appUrl: "https://app.example.com/signup/activate" },
      }),
      createAuthFoundationFeature(),
      createSessionsFeature(),
    ],
    extraContext: (deps) => ({
      ...createDeliveryTestContext(deps),
      configResolver: createConfigResolver({ cipher: encryption }),
      configEncryption: encryption,
    }),
    authConfig: {
      ...sessionCallbacksFromLateBound(sessionCallbacks).asAuthConfig(),
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
      passwordReset: {
        requestHandler: AuthHandlers.requestPasswordReset,
        confirmHandler: AuthHandlers.resetPassword,
      },
      accountUnlock: {
        requestHandler: AuthHandlers.requestAccountUnlock,
        confirmHandler: AuthHandlers.confirmAccountUnlock,
      },
      emailVerification: {
        requestHandler: AuthHandlers.requestEmailVerification,
        confirmHandler: AuthHandlers.verifyEmail,
      },
      signup: {
        requestHandler: AuthHandlers.signupRequest,
        confirmHandler: AuthHandlers.signupConfirm,
      },
      invite: {
        acceptHandler: AuthHandlers.inviteAccept,
        acceptWithLoginHandler: AuthHandlers.inviteAcceptWithLogin,
        signupCompleteHandler: AuthHandlers.inviteSignupComplete,
        infoHandler: AuthQueries.inviteInfo,
      },
    },
    anonymousAccess: { defaultTenantId: SYSTEM_TENANT_ID },
  });
  sessionCallbacks.set(createSessionCallbacks({ db: stack.db }));
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tenantInvitationEntity);
  await unsafePushTables(stack.db, {
    configValuesTable,
    tenantMembershipsTable,
    userSessionTable,
    notificationPreferencesTable,
  });
  await seedAuthMailTemplates(stack);
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(restoreFetch);

beforeEach(async () => {
  await resetTestTables(stack.db, [
    userTable,
    tenantMembershipsTable,
    tenantInvitationsTable,
    tenantTable,
    userSessionTable,
    eventsTable,
  ]);
  emailTransport.sent.length = 0;
  await stack.redis.flushNamespace();
  routeFetchToStack(stack);
});

// The session checker rejects sidless actors, so every acting user needs a live session row.
function withSession(user: SessionUser): Promise<SessionUser> {
  const sessionCreator =
    sessionCallbacksFromLateBound(sessionCallbacks).asAuthConfig().sessionCreator;
  if (!sessionCreator) throw new Error("session callbacks provide no sessionCreator");
  return withMintedSession(sessionCreator, user);
}

function asSystemAdmin(): Promise<SessionUser> {
  return withSession(TestUsers.systemAdmin);
}

function tokenFromLastMailTo(email: string): string {
  const mail = emailTransport.sent.filter((sent) => sent.to === email).at(-1);
  const match = (mail?.text ?? "").match(/[?&]token=([^&"'<\s\]]+)/);
  if (!match?.[1]) throw new Error(`no token in mail to ${email}`);
  return decodeURIComponent(match[1]);
}

describe("signup registration status", () => {
  test("reads the anonymous status query", async () => {
    expect(await fetchSignupRegistrationStatus()).toEqual({
      kind: "success",
      data: { enabled: true },
    });
  });
});

describe("password reset", () => {
  test("mails a link, the token resets the password once", async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      UserHandlers.create,
      {
        email: "reset@static.test",
        passwordHash: await hashPassword("old-password-123"),
        displayName: "Reset",
      },
      await asSystemAdmin(),
    );
    await seedTenantMembership(stack.db, {
      userId: created.id,
      tenantId: TENANT_ID,
      roles: ["User"],
    });

    expect(await requestPasswordReset("reset@static.test", { locale: "en" })).toEqual({
      kind: "success",
      data: undefined,
    });
    const token = tokenFromLastMailTo("reset@static.test");

    expect(await resetPassword(token, NEW_PASSWORD)).toEqual({ kind: "success", data: undefined });
    expect((await resetPassword("not-a-valid-token-at-all", NEW_PASSWORD)).kind).toBe("failure");
  });
});

describe("e-mail verification", () => {
  test("the signed token verifies the address; a forged token fails", async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      UserHandlers.create,
      {
        email: "verify@static.test",
        passwordHash: await hashPassword("old-password-123"),
        displayName: "Verify",
      },
      await asSystemAdmin(),
    );
    await seedTenantMembership(stack.db, {
      userId: created.id,
      tenantId: TENANT_ID,
      roles: ["User"],
    });
    const { token } = signVerificationToken(created.id, 60, VERIFY_SECRET);

    expect(await verifyEmail(token)).toEqual({ kind: "success", data: undefined });

    const row = (await selectMany(stack.db, userTable)).find((r) => r["id"] === created.id);
    expect(row?.["emailVerified"]).toBe(true);
    expect((await verifyEmail("forged-token-value-123")).kind).toBe("failure");
  });
});

describe("account unlock", () => {
  test("mails a link and the token lifts a lockout", async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      UserHandlers.create,
      {
        email: "locked@static.test",
        passwordHash: await hashPassword("right-password-123"),
        displayName: "Locked",
      },
      await asSystemAdmin(),
    );
    await seedTenantMembership(stack.db, {
      userId: created.id,
      tenantId: TENANT_ID,
      roles: ["User"],
    });
    for (let attempt = 0; attempt < 3; attempt++) {
      await stack.http.raw("POST", "/api/auth/login", {
        email: "locked@static.test",
        password: `wrong-${attempt}`,
      });
    }
    expect((await getLockoutState(stack.redis.redis, created.id))?.lockedUntil).not.toBeNull();

    expect(await requestAccountUnlock("locked@static.test", { locale: "en" })).toEqual({
      kind: "success",
      data: undefined,
    });
    const token = tokenFromLastMailTo("locked@static.test");

    expect(await confirmAccountUnlock(token)).toEqual({ kind: "success", data: undefined });
    expect(await getLockoutState(stack.redis.redis, created.id)).toBeNull();
    expect((await confirmAccountUnlock("forged-token-value-123")).kind).toBe("failure");
  });
});

describe("invitations", () => {
  test("looks up the invitation and accepts it with a new account", async () => {
    const tenantAdmin: SessionUser = {
      id: crypto.randomUUID(),
      tenantId: TENANT_ID,
      roles: ["TenantAdmin"],
    };
    await stack.http.writeOk(
      TenantHandlers.create,
      { id: TENANT_ID, key: "static-acct", name: "Static Acct" },
      await asSystemAdmin(),
    );
    await stack.http.writeOk(
      AuthHandlers.inviteCreate,
      { email: "invitee@static.test", role: "Editor" },
      await withSession(tenantAdmin),
    );
    const token = tokenFromLastMailTo("invitee@static.test");

    expect(await fetchInviteInfo(token)).toEqual({
      kind: "success",
      data: { email: "invitee@static.test", hasAccount: false },
    });
    const accepted = await acceptInviteWithNewAccount(token, NEW_PASSWORD);
    expect(accepted).toMatchObject({
      kind: "success",
      data: { status: "accepted", tenantId: TENANT_ID },
    });
    expect((await fetchInviteInfo(token)).kind).toBe("failure");
  });
});

describe("sessions", () => {
  test("accepting an invitation without a session fails as unauthenticated", async () => {
    const result = await acceptInviteSignedIn("any-token-value-1234");
    // The real route answers 401 with code missing_token, so that code wins over the fallback.
    expect(result).toMatchObject({ kind: "failure", reason: "missing_token" });
  });

  test("logout revokes the session the cookies belong to", async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      UserHandlers.create,
      {
        email: "leaver@static.test",
        passwordHash: await hashPassword("leave-password-123"),
        displayName: "Leaver",
      },
      await asSystemAdmin(),
    );
    await seedTenantMembership(stack.db, {
      userId: created.id,
      tenantId: TENANT_ID,
      roles: ["User"],
    });
    expect(await verifyEmail(signVerificationToken(created.id, 60, VERIFY_SECRET).token)).toEqual({
      kind: "success",
      data: undefined,
    });
    const loginRes = await stack.http.raw("POST", "/api/auth/login", {
      email: "leaver@static.test",
      password: "leave-password-123",
    });
    const authCookie = getSetCookieValue(loginRes, "kumiko_auth");
    const csrfCookie = getSetCookieValue(loginRes, "kumiko_csrf");
    if (!authCookie || !csrfCookie) throw new Error("login set no session cookies");
    const session: BrowserSession = { authCookie, csrfCookie };
    const tenantsWithSession = () =>
      stack.app.request("/api/auth/tenants", {
        headers: { Cookie: `kumiko_auth=${authCookie}` },
      });
    expect((await tenantsWithSession()).status).toBe(200);

    routeFetchToStack(stack, session);
    expect(await logout()).toEqual({ kind: "success", data: undefined });

    expect((await tenantsWithSession()).status).toBe(401);
  });
});
