// Cross-feature SaaS identity wire suite — one mount that mirrors a real app
// stack (composeIdentityStack + delivery + renderer + channel-email) and drives
// the happy paths apps always need. Proves auth ↔ delivery mail ↔ sessions
// (login jti + mine) ↔ MFA challenge/verify. Renderer stack is mounted for
// delivery deps; channel-email uses an injected in-memory transport (not a
// template-resolver round-trip). Edge cases stay in per-feature suites.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { AuthErrors, AuthHandlers } from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
import {
  seedAdmin,
  seedUserWithPassword,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password/seeding";
import {
  AuthMfaHandlers,
  base32Decode,
  bindMfaRevokeAllOtherSessionsFromFeature,
  userMfaEntity,
  userMfaTable,
} from "@cosmicdrift/kumiko-bundled-features/auth-mfa";
import { currentTotpCode } from "@cosmicdrift/kumiko-bundled-features/auth-mfa/testing";
import {
  createChannelEmailFeature,
  createInMemoryTransport,
} from "@cosmicdrift/kumiko-bundled-features/channel-email";
import {
  configValuesTable,
  createConfigResolver,
} from "@cosmicdrift/kumiko-bundled-features/config";
import { createDeliveryTestContext } from "@cosmicdrift/kumiko-bundled-features/delivery";
import { notificationPreferencesTable } from "@cosmicdrift/kumiko-bundled-features/delivery/tables";
import { simpleRenderer } from "@cosmicdrift/kumiko-bundled-features/renderer-simple";
import {
  createSessionCallbacks,
  type SessionCallbacks,
  SessionQueries,
  userSessionEntity,
  userSessionTable,
} from "@cosmicdrift/kumiko-bundled-features/sessions";
import { sessionCallbacksFromLateBound } from "@cosmicdrift/kumiko-bundled-features/sessions/testing";
import {
  tenantEntity,
  tenantInvitationEntity,
  tenantInvitationsTable,
  tenantMembershipsTable,
  tenantTable,
} from "@cosmicdrift/kumiko-bundled-features/tenant";
import {
  seedTenant,
  seedTenantMembership,
} from "@cosmicdrift/kumiko-bundled-features/tenant/seeding";
import { userEntity, userTable } from "@cosmicdrift/kumiko-bundled-features/user";
import { asRawClient, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { configureEntityFieldEncryption } from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  createLateBoundHolder,
  createTestEnvelopeCipher,
  deleteRows,
  updateRows,
} from "@cosmicdrift/kumiko-framework/testing";
import { composeFeatures } from "@cosmicdrift/kumiko-server-runtime/compose-features";
import * as jose from "jose";
import { composeIdentityStack, composeOpsStack, composeRendererStack } from "../compose-stacks";

const SETUP_TOKEN_SECRET = "wire-mfa-setup-secret-at-least-32-bytes-long!!";
const CHALLENGE_TOKEN_SECRET = "wire-mfa-challenge-secret-at-least-32-bytes!!";
const RESET_SECRET = randomBytes(32).toString("base64");
const VERIFY_SECRET = randomBytes(32).toString("base64");
const APP_SIGNUP_URL = "https://app.example.com/signup/complete";
const APP_RESET_URL = "https://app.example.com/reset";
const APP_VERIFY_URL = "https://app.example.com/verify";
const APP_INVITE_URL = "https://app.example.com/invite/accept";

const emailTransport = createInMemoryTransport();
const callbacks = createLateBoundHolder<SessionCallbacks>("session-callbacks");

let stack: TestStack;

function extractTokenFromMail(html: string): string {
  const match = html.match(/[?&]token=([^&"'<\s]+)/);
  if (!match?.[1]) throw new Error(`No token in mail html: ${html.slice(0, 200)}`);
  return decodeURIComponent(match[1]);
}

async function markVerified(userId: string): Promise<void> {
  await updateRows(stack.db, userTable, { emailVerified: true }, { id: userId });
}

beforeAll(async () => {
  configureEntityFieldEncryption(createTestEnvelopeCipher());
  const bound = sessionCallbacksFromLateBound(callbacks);

  const identity = composeIdentityStack({
    mfa: {
      setupTokenSecret: SETUP_TOKEN_SECRET,
      challengeTokenSecret: CHALLENGE_TOKEN_SECRET,
      issuer: "Kumiko Wire",
    },
  });
  const mfaFeature = identity.find((f) => f.name === "auth-mfa");
  if (!mfaFeature) throw new Error("composeIdentityStack did not mount auth-mfa");

  const features = composeFeatures(
    [
      ...identity,
      ...composeOpsStack({ delivery: true, audit: false, jobs: false }),
      ...composeRendererStack(),
      createChannelEmailFeature({
        transport: emailTransport,
        renderer: simpleRenderer,
        resolveEmail: async () => "unused@test.local",
      }),
    ],
    {
      includeBundled: true,
      authOptions: {
        signup: { tokenTtlMinutes: 60, appUrl: APP_SIGNUP_URL },
        invite: { tokenTtlMinutes: 60, appUrl: APP_INVITE_URL },
        passwordReset: {
          hmacSecret: RESET_SECRET,
          tokenTtlMinutes: 15,
          appUrl: APP_RESET_URL,
        },
        emailVerification: {
          hmacSecret: VERIFY_SECRET,
          tokenTtlMinutes: 60,
          mode: "strict",
          appUrl: APP_VERIFY_URL,
        },
      },
    },
  );

  stack = await setupTestStack({
    features,
    extraContext: (deps) => ({
      ...createDeliveryTestContext(deps),
      configResolver: createConfigResolver(),
    }),
    authConfig: {
      ...bound.asAuthConfig(),
      // No sessionStrictMode: seed/writeOk uses TestUsers JWTs without sid.
      // Login still gets jti via sessionCreator (asserted below).
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
      mfaVerifyHandler: AuthMfaHandlers.verify,
      loginErrorStatusMap: {
        [AuthErrors.invalidCredentials]: 401,
        [AuthErrors.noMembership]: 403,
        [AuthErrors.emailNotVerified]: 403,
      },
      signup: {
        requestHandler: AuthHandlers.signupRequest,
        confirmHandler: AuthHandlers.signupConfirm,
      },
      passwordReset: {
        requestHandler: AuthHandlers.requestPasswordReset,
        confirmHandler: AuthHandlers.resetPassword,
      },
      emailVerification: {
        requestHandler: AuthHandlers.requestEmailVerification,
        confirmHandler: AuthHandlers.verifyEmail,
      },
      invite: {
        acceptHandler: AuthHandlers.inviteAccept,
        acceptWithLoginHandler: AuthHandlers.inviteAcceptWithLogin,
        signupCompleteHandler: AuthHandlers.inviteSignupComplete,
      },
    },
  });

  const sessionCallbacks = createSessionCallbacks({ db: stack.db });
  callbacks.set(sessionCallbacks);
  bindMfaRevokeAllOtherSessionsFromFeature(mfaFeature)?.(sessionCallbacks.sessionRevokeAllOthers);

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tenantInvitationEntity);
  await unsafeCreateEntityTable(stack.db, userMfaEntity);
  await unsafeCreateEntityTable(stack.db, userSessionEntity);
  await unsafePushTables(stack.db, {
    configValuesTable,
    tenantMembershipsTable,
    notificationPreferencesTable,
    userSessionTable,
  });
});

afterAll(async () => {
  await stack?.cleanup();
  configureEntityFieldEncryption(undefined);
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantMembershipsTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantInvitationsTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantTable.tableName}"`);
  await deleteRows(stack.db, userSessionTable, {});
  await deleteRows(stack.db, userMfaTable, {});
  emailTransport.sent.length = 0;
  for (const pattern of ["signup:*", "invite:*"] as const) {
    const keys = await stack.redis.redis.keys(pattern);
    if (keys.length > 0) await stack.redis.redis.del(...keys);
  }
});

describe("saas-identity-wire", () => {
  test("signup → delivery mail → confirm → login JWT with sid", async () => {
    const email = "signup-wire@example.com";
    const password = "fresh-secure-pw-1234";

    const req = await stack.http.raw("POST", "/api/auth/signup-request", { email });
    expect(req.status).toBe(200);
    expect(emailTransport.sent).toHaveLength(1);
    const token = extractTokenFromMail(emailTransport.sent[0]?.html ?? "");

    const confirm = await stack.http.raw("POST", "/api/auth/signup-confirm", { token, password });
    expect(confirm.status).toBe(200);

    const login = await stack.http.raw("POST", "/api/auth/login", { email, password });
    expect(login.status).toBe(200);
    const body = (await login.json()) as { token?: string };
    expect(body.token).toBeTypeOf("string");
    expect(typeof jose.decodeJwt(body.token!).jti).toBe("string");
  });

  test("password reset → delivery mail → reset → login with new password", async () => {
    const email = "reset-wire@example.com";
    const oldPassword = "old-password-1234";
    const newPassword = "new-password-5678";
    const tenantId = "00000000-0000-4000-8000-000000000001" as TenantId;
    const { id } = await seedAdmin(stack.db, {
      email,
      password: oldPassword,
      displayName: "Reset",
      memberships: [
        {
          tenantId,
          tenantKey: "reset-wire",
          tenantName: "Reset Wire",
          roles: ["User"],
        },
      ],
    });
    await markVerified(id);

    const req = await stack.http.raw("POST", "/api/auth/request-password-reset", { email });
    expect(req.status).toBe(200);
    expect(emailTransport.sent).toHaveLength(1);
    const token = extractTokenFromMail(emailTransport.sent[0]?.html ?? "");

    const reset = await stack.http.raw("POST", "/api/auth/reset-password", {
      token,
      newPassword,
    });
    expect(reset.status).toBe(200);

    const oldLogin = await stack.http.raw("POST", "/api/auth/login", {
      email,
      password: oldPassword,
    });
    expect(oldLogin.status).toBe(401);

    const login = await stack.http.raw("POST", "/api/auth/login", { email, password: newPassword });
    expect(login.status).toBe(200);
    const body = (await login.json()) as { token?: string };
    expect(body.token).toBeTypeOf("string");
  });

  test("invite Branch3 → signup-complete → login", async () => {
    const tenantId = crypto.randomUUID() as TenantId;
    const { id: adminId } = await seedAdmin(stack.db, {
      email: "admin-wire@example.com",
      password: "admin-password-1234",
      displayName: "Admin",
      memberships: [
        {
          tenantId,
          tenantKey: `invite-${tenantId.slice(0, 8)}`,
          tenantName: "Invite Wire",
          roles: ["Admin"],
        },
      ],
    });
    await markVerified(adminId);

    const admin: SessionUser = { id: adminId, tenantId, roles: ["Admin"] };
    const invitee = "carol-wire@example.com";
    await stack.http.writeOk(AuthHandlers.inviteCreate, { email: invitee, role: "User" }, admin);
    expect(emailTransport.sent.length).toBeGreaterThanOrEqual(1);
    const token = extractTokenFromMail(emailTransport.sent.at(-1)?.html ?? "");

    const complete = await stack.http.raw("POST", "/api/auth/invite-signup-complete", {
      token,
      password: "carol-new-pw-1234",
    });
    expect(complete.status).toBe(200);

    const login = await stack.http.raw("POST", "/api/auth/login", {
      email: invitee,
      password: "carol-new-pw-1234",
    });
    expect(login.status).toBe(200);
  });

  test("email verify gate: unverified blocked → verify → login ok", async () => {
    const email = "verify-wire@example.com";
    const password = "verify-password-1234";
    const tenantId = "00000000-0000-4000-8000-000000000002" as TenantId;
    await seedTenant(stack.db, {
      id: tenantId,
      key: "verify-wire",
      name: "Verify Wire",
    });
    const { id } = await seedUserWithPassword(stack.db, {
      email,
      password,
      displayName: "Verify",
      emailVerified: false,
    });
    await seedTenantMembership(stack.db, {
      userId: id,
      tenantId,
      roles: ["User"],
    });

    const blocked = await stack.http.raw("POST", "/api/auth/login", { email, password });
    expect(blocked.status).toBe(403);
    const blockedBody = (await blocked.json()) as { error?: { details?: { reason?: string } } };
    expect(blockedBody.error?.details?.reason).toBe(AuthErrors.emailNotVerified);

    const req = await stack.http.raw("POST", "/api/auth/request-email-verification", { email });
    expect(req.status).toBe(200);
    expect(emailTransport.sent).toHaveLength(1);
    const token = extractTokenFromMail(emailTransport.sent[0]?.html ?? "");

    const verify = await stack.http.raw("POST", "/api/auth/verify-email", { token });
    expect(verify.status).toBe(200);

    const login = await stack.http.raw("POST", "/api/auth/login", { email, password });
    expect(login.status).toBe(200);
  });

  test("MFA enable → login challenges → verify JWT; sessions:mine lists sid", async () => {
    const email = "mfa-wire@example.com";
    const password = "mfa-password-1234";
    const tenantId = "00000000-0000-4000-8000-000000000003" as TenantId;
    const { id: userId } = await seedAdmin(stack.db, {
      email,
      password,
      displayName: "Mfa",
      memberships: [
        {
          tenantId,
          tenantKey: "mfa-wire",
          tenantName: "MFA Wire",
          roles: ["User"],
        },
      ],
    });
    await markVerified(userId);
    const user: SessionUser = { id: userId, tenantId, roles: ["User"] };

    const start = await stack.http.writeOk<{ setupToken: string; otpauthUri: string }>(
      AuthMfaHandlers.enableStart,
      { accountLabel: email },
      user,
    );
    const secretParam = new URLSearchParams(start.otpauthUri.split("?")[1]).get("secret") ?? "";
    const secret = base32Decode(secretParam);
    await stack.http.writeOk(
      AuthMfaHandlers.enableConfirm,
      { setupToken: start.setupToken, code: currentTotpCode(secret) },
      user,
    );

    const login = await stack.http.raw("POST", "/api/auth/login", { email, password });
    expect(login.status).toBe(200);
    const challenge = (await login.json()) as {
      mfaRequired?: boolean;
      challengeToken?: string;
      token?: string;
    };
    expect(challenge.mfaRequired).toBe(true);
    expect(challenge.token).toBeUndefined();
    expect(challenge.challengeToken).toBeTypeOf("string");

    const verify = await stack.http.raw("POST", "/api/auth/mfa/verify", {
      challengeToken: challenge.challengeToken,
      code: currentTotpCode(secret),
    });
    expect(verify.status).toBe(200);
    const { token } = (await verify.json()) as { token: string };
    expect(token).toBeTypeOf("string");
    const sid = jose.decodeJwt(token).jti;
    expect(typeof sid).toBe("string");

    const mineRes = await stack.http.raw(
      "POST",
      "/api/query",
      { type: SessionQueries.mine, payload: {} },
      { Authorization: `Bearer ${token}` },
    );
    expect(mineRes.status).toBe(200);
    const mineBody = (await mineRes.json()) as {
      data?: Array<{ id: string }> | { items?: Array<{ id: string }> };
    };
    const items = Array.isArray(mineBody.data) ? mineBody.data : (mineBody.data?.items ?? []);
    expect(items.some((s) => s.id === sid)).toBe(true);

    const rows = await selectMany(stack.db, userSessionTable, { userId });
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
