// Session-issuing routes other than /auth/login must run the same MFA gate:
// switch-tenant into a tenant where the user holds an admin role, and the
// first session of invite-signup-complete and signup-confirm. Real HTTP through setupTestStack
// under requiredPolicy "admins".

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { configureEntityFieldEncryption } from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { createTestEnvelopeCipher } from "@cosmicdrift/kumiko-framework/testing";
import { AuthMfaHandlers } from "../../auth-mfa/constants.js";
import { createAuthMfaFeature, mfaStatusCheckerFromFeature } from "../../auth-mfa/feature.js";
import { base32Decode } from "../../auth-mfa/index.js";
import { userMfaEntity } from "../../auth-mfa/schema/user-mfa.js";
import { currentTotpCode } from "../../auth-mfa/totp.js";
import { createChannelEmailFeature, createInMemoryTransport } from "../../channel-email/index.js";
import { createConfigFeature } from "../../config/index.js";
import { createConfigResolver } from "../../config/resolver.js";
import { configValuesTable } from "../../config/table.js";
import { createDeliveryFeature, createDeliveryTestContext } from "../../delivery/index.js";
import { notificationPreferencesTable } from "../../delivery/tables.js";
import { createRendererFoundationFeature } from "../../renderer-foundation/feature.js";
import { createRendererSimpleFeature, simpleRenderer } from "../../renderer-simple/index.js";
import { hashPassword } from "../../shared/index.js";
import { createTemplateResolverFeature } from "../../template-resolver/feature.js";
import { createTenantFeature } from "../../tenant/index.js";
import { tenantInvitationEntity, tenantInvitationsTable } from "../../tenant/invitation-table.js";
import { tenantMembershipsTable } from "../../tenant/membership-table.js";
import { tenantEntity, tenantTable } from "../../tenant/schema/tenant.js";
import { seedTenant, seedTenantMembership } from "../../tenant/seeding.js";
import { createUserFeature } from "../../user/feature.js";
import { userEntity, userTable } from "../../user/schema/user.js";
import { AuthErrors, AuthHandlers, AuthQueries } from "../constants.js";
import { createAuthEmailPasswordFeature } from "../feature.js";
import { INITIAL_SIGNUP_ROLES, seedUser } from "../seeding.js";

const PASSWORD = "mfa-gates-pw-1234";
const emailTransport = createInMemoryTransport();
let stack: TestStack;
let tenantA: TenantId;
let tenantB: TenantId;

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  configureEntityFieldEncryption(encryption);
  const authMfaFeature = createAuthMfaFeature({
    setupTokenSecret: "test-mfa-setup-token-secret-at-least-32-bytes!!",
    issuer: "Kumiko Test",
    challengeTokenSecret: "test-mfa-challenge-secret-at-least-32-bytes!!",
    requiredPolicy: "admins",
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
        invite: { tokenTtlMinutes: 60, appUrl: "https://app.example.com/invite/accept" },
        signup: { tokenTtlMinutes: 60, appUrl: "https://app.example.com/signup/complete" },
        mfaStatusChecker: mfaStatusCheckerFromFeature(authMfaFeature),
      }),
    ],
    extraContext: (deps) => ({
      ...createDeliveryTestContext(deps),
      configResolver: createConfigResolver({ cipher: encryption }),
      configEncryption: encryption,
    }),
    authConfig: {
      postAuthLanding: (args) =>
        args.flow === "signup" ? `/landing/${args.tenantKey}/${args.roles.join(",")}` : undefined,
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
      mfaVerifyHandler: AuthMfaHandlers.verify,
      switchTenantMfaGateHandler: AuthHandlers.switchTenantMfaGate,
      invite: {
        acceptHandler: AuthHandlers.inviteAccept,
        acceptWithLoginHandler: AuthHandlers.inviteAcceptWithLogin,
        signupCompleteHandler: AuthHandlers.inviteSignupComplete,
        infoHandler: AuthQueries.inviteInfo,
      },
      signup: {
        requestHandler: AuthHandlers.signupRequest,
        confirmHandler: AuthHandlers.signupConfirm,
      },
      loginErrorStatusMap: {
        [AuthErrors.invalidCredentials]: 401,
        [AuthErrors.noMembership]: 403,
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
  await resetEventStore(stack, [
    userTable,
    tenantMembershipsTable,
    tenantInvitationsTable,
    tenantTable,
    userMfaEntity.table,
  ]);
  emailTransport.sent.length = 0;
  await stack.redis.flushNamespace();
  tenantA = crypto.randomUUID() as TenantId;
  tenantB = crypto.randomUUID() as TenantId;
  await seedTenant(stack.db, { id: tenantA, key: `a-${tenantA.slice(0, 8)}`, name: "A" });
  await seedTenant(stack.db, { id: tenantB, key: `b-${tenantB.slice(0, 8)}`, name: "B" });
});

async function authedRaw(user: SessionUser, path: string, body: unknown): Promise<Response> {
  const token = await stack.jwt.sign(user);
  return stack.http.raw("POST", path, body, { Authorization: `Bearer ${token}` });
}

// Member in tenant A, admin in tenant B.
async function seedMemberInAAdminInB(email: string): Promise<string> {
  const { id } = await seedUser(stack.db, {
    email,
    displayName: "Dual",
    passwordHash: await hashPassword(PASSWORD),
    emailVerified: true,
  });
  await seedTenantMembership(stack.db, { userId: id, tenantId: tenantA, roles: ["User"] });
  await seedTenantMembership(stack.db, { userId: id, tenantId: tenantB, roles: ["Admin"] });
  return id;
}

describe("switch-tenant runs the login's MFA gate", () => {
  test("an unenrolled user switching into a tenant where they are admin gets the setup step, no session", async () => {
    const id = await seedMemberInAAdminInB("dual-unenrolled@example.com");

    const res = await authedRaw(
      { id, tenantId: tenantA, roles: ["User"] },
      "/api/auth/switch-tenant",
      {
        tenantId: tenantB,
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mfaSetupRequired).toBe(true);
    expect(typeof body.preauthSetupToken).toBe("string");
    expect(body.token).toBeUndefined();
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  test("an enrolled user switching into the admin tenant must answer the MFA challenge", async () => {
    const id = await seedMemberInAAdminInB("dual-enrolled@example.com");
    const inA: SessionUser = { id, tenantId: tenantA, roles: ["User"] };
    // Factors are per tenant: the one that gates tenant B has to be enrolled there.
    const inB: SessionUser = { id, tenantId: tenantB, roles: ["Admin"] };
    const started = (await (
      await authedRaw(inB, "/api/write", {
        type: AuthMfaHandlers.enableStart,
        payload: {},
      })
    ).json()) as { data: { setupToken: string; totpSecret: string } };
    const secret = started.data.totpSecret;
    const confirmed = await authedRaw(inB, "/api/write", {
      type: AuthMfaHandlers.enableConfirm,
      payload: {
        setupToken: started.data.setupToken,
        code: currentTotpCode(base32Decode(secret)),
      },
    });
    expect(confirmed.status).toBe(200);

    const res = await authedRaw(inA, "/api/auth/switch-tenant", { tenantId: tenantB });

    const body = await res.json();
    expect(body.mfaRequired).toBe(true);
    expect(body.token).toBeUndefined();
    const verify = await stack.http.raw("POST", "/api/auth/mfa/verify", {
      challengeToken: body.challengeToken,
      // Next TOTP step: the enrollment confirm burned the current one.
      code: currentTotpCode(base32Decode(secret), Date.now() + 30_000),
    });
    expect(verify.status).toBe(200);
    const verified = await verify.json();
    expect((await stack.jwt.verify(verified.token)).tenantId).toBe(tenantB);
  });

  test("switching into a tenant where the user is only a member still mints the session directly", async () => {
    const id = await seedMemberInAAdminInB("dual-member@example.com");

    const res = await authedRaw(
      { id, tenantId: tenantB, roles: ["Admin"] },
      "/api/auth/switch-tenant",
      { tenantId: tenantA },
    );

    expect(res.status).toBe(200);
    expect(typeof (await res.json()).token).toBe("string");
  });
});

describe("switch-tenant gate boundaries", () => {
  test("the gate handler is not callable through /api/write by a signed-in user", async () => {
    const id = await seedMemberInAAdminInB("dual-direct@example.com");

    const res = await authedRaw({ id, tenantId: tenantA, roles: ["User"] }, "/api/write", {
      type: AuthHandlers.switchTenantMfaGate,
      payload: { userId: id, tenantId: tenantB },
    });

    expect(res.status).toBe(403);
    expect((await res.json()).challengeToken).toBeUndefined();
  });

  test("switching into a tenant without membership fails and yields no token", async () => {
    const id = await seedMemberInAAdminInB("dual-nomember@example.com");
    const tenantC = crypto.randomUUID() as TenantId;
    await seedTenant(stack.db, { id: tenantC, key: `c-${tenantC.slice(0, 8)}`, name: "C" });

    const res = await authedRaw(
      { id, tenantId: tenantA, roles: ["User"] },
      "/api/auth/switch-tenant",
      {
        tenantId: tenantC,
      },
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = await res.json();
    expect(body.token).toBeUndefined();
    expect(body.challengeToken).toBeUndefined();
    expect(body.preauthSetupToken).toBeUndefined();
  });
});

describe("invite-signup-complete runs the login's MFA gate", () => {
  async function inviteAndComplete(email: string, role: string): Promise<Response> {
    const { id: inviterId } = await seedUser(stack.db, {
      email: `inviter-${role}@example.com`,
      displayName: "Inviter",
      passwordHash: await hashPassword(PASSWORD),
      emailVerified: true,
    });
    await stack.http.writeOk(
      AuthHandlers.inviteCreate,
      { email, role },
      { id: inviterId, tenantId: tenantA, roles: ["Admin"] },
    );
    const sent = emailTransport.sent.at(-1);
    const token = sent?.html.match(/[?&]token=([^&"'<\s]+)/)?.[1];
    if (token === undefined) throw new Error("invite-create sent no token mail");
    return stack.http.raw("POST", "/api/auth/invite-signup-complete", {
      token: decodeURIComponent(token),
      password: "invitee-new-pw-1234",
    });
  }

  test("an admin invitation creates the account but answers with the MFA setup step, no session", async () => {
    const res = await inviteAndComplete("new-admin@example.com", "Admin");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mfaSetupRequired).toBe(true);
    expect(body.token).toBeUndefined();
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await selectMany(stack.db, userTable, { email: "new-admin@example.com" })).toHaveLength(
      1,
    );
  });

  test("a member invitation still gets its session directly", async () => {
    const res = await inviteAndComplete("new-member@example.com", "User");

    expect(res.status).toBe(200);
    expect(typeof (await res.json()).token).toBe("string");
  });
});

describe("signup-confirm runs the login's MFA gate", () => {
  async function requestSignupToken(email: string): Promise<string> {
    emailTransport.sent.length = 0;
    const res = await stack.http.raw(
      "POST",
      "/api/auth/signup-request",
      { email },
      { "x-forwarded-for": email },
    );
    expect(res.status).toBe(200);
    const token = emailTransport.sent.at(-1)?.html.match(/[?&]token=([^&"'<\s]+)/)?.[1];
    if (token === undefined) throw new Error("signup-request sent no token mail");
    return decodeURIComponent(token);
  }

  test("signup-confirm creates the account but answers with the MFA setup step, no session", async () => {
    const email = "new-signup@example.com";
    const password = "signup-new-pw-1234";
    const token = await requestSignupToken(email);

    const res = await stack.http.raw("POST", "/api/auth/signup-confirm", { token, password });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mfaSetupRequired).toBe(true);
    expect(typeof body.preauthSetupToken).toBe("string");
    expect(body.token).toBeUndefined();
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await selectMany(stack.db, userTable, { email })).toHaveLength(1);

    // Same landing a signup without the MFA gate would have returned.
    const [tenant] = await selectMany(stack.db, tenantTable, { name: email });
    expect(body.landingPath).toBe(`/landing/${tenant?.["key"]}/${INITIAL_SIGNUP_ROLES.join(",")}`);

    const login = await stack.http.raw("POST", "/api/auth/login", { email, password });
    expect(login.status).toBe(200);
    const loginBody = await login.json();
    expect(loginBody.mfaSetupRequired).toBe(true);
    expect(loginBody.token).toBeUndefined();
  });

  test("a signed-in user cannot call the signup-confirm handler through /api/write", async () => {
    const email = "write-bypass@example.com";
    const token = await requestSignupToken(email);
    const id = await seedMemberInAAdminInB("signed-in-caller@example.com");

    const res = await authedRaw({ id, tenantId: tenantA, roles: ["User"] }, "/api/write", {
      type: AuthHandlers.signupConfirm,
      payload: { token, password: "signup-new-pw-1234" },
    });

    expect(res.status).toBe(403);
    expect(await selectMany(stack.db, userTable, { email })).toHaveLength(0);
  });

  test("an unauthenticated caller cannot reach the signup-confirm handler through /api/write", async () => {
    const email = "anon-write-bypass@example.com";
    const token = await requestSignupToken(email);

    const res = await stack.http.raw("POST", "/api/write", {
      type: AuthHandlers.signupConfirm,
      payload: { token, password: "signup-new-pw-1234" },
    });

    expect(res.status).toBe(401);
    expect(await selectMany(stack.db, userTable, { email })).toHaveLength(0);
  });
});
