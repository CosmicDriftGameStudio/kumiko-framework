// Full-stack wiring test for kumiko-framework#266 Step 6: proves the exact
// bootstrap path runProdApp/runDevApp produce — composeFeatures() auto-
// detecting a mounted auth-mfa app-feature and wiring its status-checker
// into the login handler — actually completes a two-step login over real
// HTTP. compose-features-wiring.integration.test.ts pins the same pattern
// for passwordReset/emailVerification; this is the auth-mfa analogue.
//
// No mocking: setupTestStack boots a real DB + Redis.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  AuthHandlers,
  hashPassword,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
import {
  AuthMfaHandlers,
  base32Decode,
  bindMfaRevokeAllOtherSessionsFromFeature,
  createAuthMfaFeature,
  mfaRequiredConfigHandle,
  userMfaEntity,
} from "@cosmicdrift/kumiko-bundled-features/auth-mfa";
import { currentTotpCode } from "@cosmicdrift/kumiko-bundled-features/auth-mfa/testing";
import {
  configValuesTable,
  createConfigResolver,
} from "@cosmicdrift/kumiko-bundled-features/config";
import {
  createSessionCallbacks,
  userSessionEntity,
} from "@cosmicdrift/kumiko-bundled-features/sessions";
import { tenantEntity, tenantMembershipsTable } from "@cosmicdrift/kumiko-bundled-features/tenant";
import { seedTenantMembership } from "@cosmicdrift/kumiko-bundled-features/tenant/testing";
import { UserHandlers, userEntity, userTable } from "@cosmicdrift/kumiko-bundled-features/user";
import { configureEntityFieldEncryption } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { createTestEnvelopeCipher, deleteRows } from "@cosmicdrift/kumiko-framework/testing";
import { composeFeatures } from "../compose-features";

const CHALLENGE_TOKEN_SECRET = "test-mfa-challenge-secret-at-least-32-bytes!!";
const SETUP_TOKEN_SECRET = "test-mfa-setup-secret-at-least-32-bytes-long!!";
const TEST_TENANT_ID: TenantId = "00000000-0000-4000-8000-000000000001" as TenantId;
const systemAdmin = TestUsers.systemAdmin;

async function bootStack(): Promise<TestStack> {
  configureEntityFieldEncryption(createTestEnvelopeCipher());
  const mfaFeature = createAuthMfaFeature({
    setupTokenSecret: SETUP_TOKEN_SECRET,
    challengeTokenSecret: CHALLENGE_TOKEN_SECRET,
    issuer: "Kumiko Test",
  });

  // Exactly what runProdApp/runDevApp do: composeFeatures sees auth-mfa in
  // the app-feature list and threads mfaStatusChecker into the bundled
  // auth-email-password feature's login handler on its own — no authOptions
  // override needed here, which is the thing this test proves.
  const features = composeFeatures([mfaFeature], { includeBundled: true });

  const stack = await setupTestStack({
    features,
    extraContext: () => ({ configResolver: createConfigResolver() }),
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
      mfaVerifyHandler: AuthMfaHandlers.verify,
    },
  });

  const sessionCallbacks = createSessionCallbacks({ db: stack.db });
  bindMfaRevokeAllOtherSessionsFromFeature(mfaFeature)?.(sessionCallbacks.sessionRevokeAllOthers);

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, userMfaEntity);
  await unsafeCreateEntityTable(stack.db, userSessionEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });

  return stack;
}

async function seedUser(
  stack: TestStack,
  opts: { email: string; password: string; roles?: readonly string[] },
): Promise<{ id: string }> {
  const hash = await hashPassword(opts.password);
  const created = await stack.http.writeOk<{ id: string }>(
    UserHandlers.create,
    { email: opts.email, passwordHash: hash, displayName: opts.email.split("@")[0] ?? "user" },
    systemAdmin,
  );
  await seedTenantMembership(stack.db, {
    userId: created.id,
    tenantId: TEST_TENANT_ID,
    roles: opts.roles ?? ["User"],
  });
  return { id: created.id };
}

describe("composeFeatures wiring — auth-mfa (kumiko-framework#266 Step 6)", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await bootStack();
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  beforeEach(async () => {
    await deleteRows(stack.db, userTable, {});
    await deleteRows(stack.db, tenantMembershipsTable, {});
  });

  test("full login-with-MFA flow: password login → mfa-challenge → /auth/mfa/verify → session", async () => {
    const user = await seedUser(stack, {
      email: "alice@example.com",
      password: "correct-password-1234",
    });

    const start = await stack.http.writeOk<{ setupToken: string; otpauthUri: string }>(
      AuthMfaHandlers.enableStart,
      { accountLabel: "alice@example.com" },
      { id: user.id, tenantId: TEST_TENANT_ID, roles: ["User"] },
    );
    const secretParam = new URLSearchParams(start.otpauthUri.split("?")[1]).get("secret") ?? "";
    const secret = base32Decode(secretParam);
    await stack.http.writeOk(
      AuthMfaHandlers.enableConfirm,
      { setupToken: start.setupToken, code: currentTotpCode(secret) },
      { id: user.id, tenantId: TEST_TENANT_ID, roles: ["User"] },
    );

    // Step 1: a correct password no longer mints a session directly — it
    // hands back a challenge, proving composeFeatures actually wired
    // mfaStatusChecker into the login handler (without the wiring this
    // would 200 straight to a session and the test would fail below).
    const loginRes = await stack.http.raw("POST", "/api/auth/login", {
      email: "alice@example.com",
      password: "correct-password-1234",
    });
    expect(loginRes.status).toBe(200);
    const loginBody = (await loginRes.json()) as {
      isSuccess: boolean;
      mfaRequired?: boolean;
      challengeToken?: string;
    };
    expect(loginBody.mfaRequired).toBe(true);
    expect(loginBody.challengeToken).toBeTruthy();
    const challengeToken = loginBody.challengeToken;
    if (!challengeToken) throw new Error("no challengeToken in login response");

    // Step 2: completing the challenge over the REAL /api/auth/mfa/verify
    // route (not a direct handler dispatch) mints the session.
    const verifyRes = await stack.http.raw("POST", "/api/auth/mfa/verify", {
      challengeToken,
      code: currentTotpCode(secret),
    });
    expect(verifyRes.status).toBe(200);
    const verifyBody = (await verifyRes.json()) as {
      isSuccess: boolean;
      token: string;
      user: { id: string; tenantId: string };
    };
    expect(verifyBody.isSuccess).toBe(true);
    expect(verifyBody.token).toBeTruthy();
    expect(verifyBody.user.id).toBe(user.id);
  });

  test("a user without MFA enabled logs in with a straight session (no challenge)", async () => {
    await seedUser(stack, { email: "bob@example.com", password: "any-password-1234" });

    const res = await stack.http.raw("POST", "/api/auth/login", {
      email: "bob@example.com",
      password: "any-password-1234",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      isSuccess: boolean;
      mfaRequired?: boolean;
      token?: string;
    };
    expect(body.mfaRequired).toBeUndefined();
    expect(body.token).toBeTruthy();
  });
});

async function setPolicy(stack: TestStack, policy: "optional" | "admins" | "all"): Promise<void> {
  await stack.http.writeOk(
    "config:write:set",
    { key: mfaRequiredConfigHandle.name, value: policy },
    { id: systemAdmin.id, tenantId: TEST_TENANT_ID, roles: ["SystemAdmin"] },
  );
}

// Step 7: enforcement policy only matters for UNENROLLED users — an
// enrolled user always gets a challenge regardless of policy (they opted
// in themselves). ponytail (see auth-mfa's config.ts): "admins"/"all"
// hard-block an unenrolled matching user with mfaSetupRequired — there is
// no enrollment-during-login UI yet (PR3). By design for this backend step.
describe("composeFeatures wiring — auth-mfa enforcement policy (kumiko-framework#266 Step 7)", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await bootStack();
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  beforeEach(async () => {
    await deleteRows(stack.db, userTable, {});
    await deleteRows(stack.db, tenantMembershipsTable, {});
    await setPolicy(stack, "optional");
  });

  test("optional (default): unenrolled user still gets a straight session", async () => {
    await seedUser(stack, { email: "carol@example.com", password: "any-password-1234" });
    const res = await stack.http.raw("POST", "/api/auth/login", {
      email: "carol@example.com",
      password: "any-password-1234",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mfaSetupRequired?: boolean; token?: string };
    expect(body.mfaSetupRequired).toBeUndefined();
    expect(body.token).toBeTruthy();
  });

  test("all: unenrolled user is blocked with mfaSetupRequired, no session/challenge", async () => {
    await setPolicy(stack, "all");
    await seedUser(stack, { email: "dave@example.com", password: "any-password-1234" });
    const res = await stack.http.raw("POST", "/api/auth/login", {
      email: "dave@example.com",
      password: "any-password-1234",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      mfaSetupRequired?: boolean;
      mfaRequired?: boolean;
      token?: string;
    };
    expect(body.mfaSetupRequired).toBe(true);
    expect(body.mfaRequired).toBeUndefined();
    expect(body.token).toBeUndefined();
  });

  test("all: an already-enrolled user still gets a challenge, not a block", async () => {
    await setPolicy(stack, "all");
    const user = await seedUser(stack, {
      email: "erin@example.com",
      password: "any-password-1234",
    });
    const start = await stack.http.writeOk<{ setupToken: string; otpauthUri: string }>(
      AuthMfaHandlers.enableStart,
      { accountLabel: "erin@example.com" },
      { id: user.id, tenantId: TEST_TENANT_ID, roles: ["User"] },
    );
    const secretParam = new URLSearchParams(start.otpauthUri.split("?")[1]).get("secret") ?? "";
    const secret = base32Decode(secretParam);
    await stack.http.writeOk(
      AuthMfaHandlers.enableConfirm,
      { setupToken: start.setupToken, code: currentTotpCode(secret) },
      { id: user.id, tenantId: TEST_TENANT_ID, roles: ["User"] },
    );

    const res = await stack.http.raw("POST", "/api/auth/login", {
      email: "erin@example.com",
      password: "any-password-1234",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mfaSetupRequired?: boolean; mfaRequired?: boolean };
    expect(body.mfaRequired).toBe(true);
    expect(body.mfaSetupRequired).toBeUndefined();
  });

  test("admins: unenrolled admin is blocked, unenrolled non-admin logs in normally", async () => {
    await setPolicy(stack, "admins");
    await seedUser(stack, {
      email: "frank-admin@example.com",
      password: "any-password-1234",
      roles: ["Admin"],
    });
    await seedUser(stack, { email: "gina-user@example.com", password: "any-password-1234" });

    const adminRes = await stack.http.raw("POST", "/api/auth/login", {
      email: "frank-admin@example.com",
      password: "any-password-1234",
    });
    const adminBody = (await adminRes.json()) as { mfaSetupRequired?: boolean };
    expect(adminBody.mfaSetupRequired).toBe(true);

    const userRes = await stack.http.raw("POST", "/api/auth/login", {
      email: "gina-user@example.com",
      password: "any-password-1234",
    });
    const userBody = (await userRes.json()) as { mfaSetupRequired?: boolean; token?: string };
    expect(userBody.mfaSetupRequired).toBeUndefined();
    expect(userBody.token).toBeTruthy();
  });
});
