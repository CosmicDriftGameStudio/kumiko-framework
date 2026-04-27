import { randomBytes } from "node:crypto";
import { createEncryptionProvider } from "@kumiko/framework/db";
import type { TenantId } from "@kumiko/framework/engine";
import {
  createEntityTable,
  createTestUser,
  pushTables,
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
} from "@kumiko/framework/stack";
import { expectErrorIncludes, getSetCookieRaw, getSetCookieValue } from "@kumiko/framework/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createConfigFeature } from "../../config";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createTenantFeature } from "../../tenant";
import { tenantMembershipsTable } from "../../tenant/membership-table";
import { tenantEntity } from "../../tenant/schema/tenant";
import { seedTenantMembership } from "../../tenant/testing";
import { UserHandlers } from "../../user";
import { createUserFeature } from "../../user/feature";
import { userEntity, userTable } from "../../user/schema/user";
import { AuthErrors, AuthHandlers } from "../constants";
import { createAuthEmailPasswordFeature } from "../feature";
import { hashPassword } from "../password-hashing";

let stack: TestStack;

const systemAdmin = TestUsers.systemAdmin;
const encryptionKey = randomBytes(32).toString("base64");

beforeAll(async () => {
  const encryption = createEncryptionProvider(encryptionKey);
  const resolver = createConfigResolver({ encryption });

  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createAuthEmailPasswordFeature(),
    ],
    extraContext: { configResolver: resolver, configEncryption: encryption },
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
      loginErrorStatusMap: {
        [AuthErrors.invalidCredentials]: 401,
        [AuthErrors.noMembership]: 403,
      },
    },
  });

  await createEntityTable(stack.db, userEntity);
  await createEntityTable(stack.db, tenantEntity);
  await pushTables(stack.db, { configValuesTable, tenantMembershipsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await stack.db.delete(userTable);
  await stack.db.delete(tenantMembershipsTable);
});

// Helper: seed a full login-ready user (user row + membership).
async function seedLoginUser(opts: {
  email: string;
  password: string;
  tenantId?: TenantId;
  roles?: string[];
}): Promise<{ id: string; tenantId: TenantId }> {
  const hash = await hashPassword(opts.password);
  const created = await stack.http.writeOk<{ id: string }>(
    UserHandlers.create,
    {
      email: opts.email,
      passwordHash: hash,
      displayName: opts.email.split("@")[0] ?? "user",
    },
    systemAdmin,
  );

  const tenantId = opts.tenantId ?? "00000000-0000-4000-8000-000000000001";
  await seedTenantMembership(stack.db, {
    userId: created.id,
    tenantId,
    roles: opts.roles ?? ["User"],
  });
  return { id: created.id, tenantId };
}

// --- Scenario 1 + 2: login with right / wrong password ---

describe("scenario 1: login success", () => {
  test("correct credentials → JWT containing id + tenantId + roles", async () => {
    const seed = await seedLoginUser({
      email: "good@example.com",
      password: "correct-horse-battery",
      roles: ["User"],
    });

    const res = await stack.http.raw("POST", "/api/auth/login", {
      email: "good@example.com",
      password: "correct-horse-battery",
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isSuccess).toBe(true);
    expect(body.token).toBeTypeOf("string");
    expect(body.user).toMatchObject({
      id: seed.id,
      tenantId: seed.tenantId,
      roles: ["User"],
    });

    // Verify the JWT is actually valid — call an authenticated endpoint with it.
    const meRes = await stack.http.raw(
      "POST",
      "/api/query",
      { type: "user:query:user:me", payload: {} },
      {
        Authorization: `Bearer ${body.token}`,
      },
    );
    expect(meRes.status).toBe(200);
  });
});

describe("scenario 2: login failure", () => {
  test("wrong password → invalid_credentials (no enumeration)", async () => {
    await seedLoginUser({ email: "wrong@example.com", password: "correct" });

    const res = await stack.http.raw("POST", "/api/auth/login", {
      email: "wrong@example.com",
      password: "nope",
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error?.details?.reason).toBe(AuthErrors.invalidCredentials);
  });

  test("unknown email → same invalid_credentials (no enumeration)", async () => {
    const res = await stack.http.raw("POST", "/api/auth/login", {
      email: "ghost@example.com",
      password: "whatever",
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error?.details?.reason).toBe(AuthErrors.invalidCredentials);
  });
});

// --- Scenario 3: login without any membership ---

describe("scenario 3: login without membership", () => {
  test("valid user but no tenant membership → no_membership", async () => {
    const hash = await hashPassword("pw");
    await stack.http.writeOk(
      UserHandlers.create,
      { email: "nomember@example.com", passwordHash: hash, displayName: "Lone" },
      systemAdmin,
    );
    // intentionally NO membership insert

    const res = await stack.http.raw("POST", "/api/auth/login", {
      email: "nomember@example.com",
      password: "pw",
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error?.details?.reason).toBe(AuthErrors.noMembership);
  });
});

// --- Scenario 4 + 5: change-password flow ---

describe("scenario 4: change-password with wrong old password", () => {
  test("wrong old → invalid_credentials, DB unchanged", async () => {
    const seed = await seedLoginUser({ email: "cp@example.com", password: "good-old" });
    const signedIn = createTestUser({ id: seed.id, tenantId: seed.tenantId, roles: ["User"] });

    const error = await stack.http.writeErr(
      AuthHandlers.changePassword,
      { oldPassword: "wrong", newPassword: "new-long-password" },
      signedIn,
    );
    expectErrorIncludes(error, AuthErrors.invalidCredentials);

    // Old password still works
    const loginRes = await stack.http.raw("POST", "/api/auth/login", {
      email: "cp@example.com",
      password: "good-old",
    });
    expect(loginRes.status).toBe(200);
  });
});

describe("scenario 5: change-password success", () => {
  test("correct old + new → old fails, new works", async () => {
    const seed = await seedLoginUser({ email: "flip@example.com", password: "before" });
    const signedIn = createTestUser({ id: seed.id, tenantId: seed.tenantId, roles: ["User"] });

    await stack.http.writeOk(
      AuthHandlers.changePassword,
      { oldPassword: "before", newPassword: "after-long-enough" },
      signedIn,
    );

    // Old password no longer works
    const oldRes = await stack.http.raw("POST", "/api/auth/login", {
      email: "flip@example.com",
      password: "before",
    });
    expect(oldRes.status).toBe(401);

    // New password works
    const newRes = await stack.http.raw("POST", "/api/auth/login", {
      email: "flip@example.com",
      password: "after-long-enough",
    });
    expect(newRes.status).toBe(200);
  });
});

// --- Scenario 6: logout is reachable for authenticated users ---

describe("scenario 6: logout", () => {
  test("authenticated user can call logout (returns success)", async () => {
    const seed = await seedLoginUser({ email: "bye@example.com", password: "pw12345678" });
    const signedIn = createTestUser({ id: seed.id, tenantId: seed.tenantId, roles: ["User"] });

    const data = await stack.http.writeOk<{ kind: string }>(AuthHandlers.logout, {}, signedIn);
    expect(data.kind).toBe("logged-out");
  });

  test("unauthenticated call to logout is rejected by framework access", async () => {
    // roles: ["all"] — no authenticated role. Handler's access is
    // access.authenticated which requires User/Admin/SystemAdmin.
    const guest = createTestUser({
      id: 0,
      tenantId: "00000000-0000-4000-8000-000000000000",
      roles: ["all"],
    });
    const error = await stack.http.writeErr(AuthHandlers.logout, {}, guest);
    expectErrorIncludes(error, "access_denied");
  });
});

// --- Scenario 7: multi-membership — lastActiveTenantId is honored ---

describe("scenario 7: multi-membership tenant resolution", () => {
  test("login picks the tenant matching lastActiveTenantId, not the first", async () => {
    const hash = await hashPassword("multi-pw-1234");
    const created = await stack.http.writeOk<{ id: string }>(
      UserHandlers.create,
      { email: "multi@example.com", passwordHash: hash, displayName: "Multi" },
      systemAdmin,
    );

    // Two memberships: tenant 1 (first) and tenant 7 (preferred).
    await seedTenantMembership(stack.db, {
      userId: created.id,
      tenantId: testTenantId(1),
      roles: ["User"],
    });
    await seedTenantMembership(stack.db, {
      userId: created.id,
      tenantId: testTenantId(7),
      roles: ["Admin"],
    });

    // Point the user at tenant 7 as their "last active" — login should land there.
    await stack.http.writeOk(
      UserHandlers.update,
      { id: created.id, changes: { lastActiveTenantId: testTenantId(7) }, version: 1 },
      systemAdmin,
    );

    const res = await stack.http.raw("POST", "/api/auth/login", {
      email: "multi@example.com",
      password: "multi-pw-1234",
    });
    const body = await res.json();

    expect(body.isSuccess).toBe(true);
    expect(body.user.tenantId).toBe(testTenantId(7));
    expect(body.user.roles).toEqual(["Admin"]);
  });

  test("login falls back to first membership when lastActiveTenantId is stale", async () => {
    // User has a lastActiveTenantId of a tenant they're no longer a member of.
    const hash = await hashPassword("stale-pw-1234");
    const created = await stack.http.writeOk<{ id: string }>(
      UserHandlers.create,
      { email: "stale@example.com", passwordHash: hash, displayName: "Stale" },
      systemAdmin,
    );
    await seedTenantMembership(stack.db, {
      userId: created.id,
      tenantId: testTenantId(3),
      roles: ["User"],
    });
    await stack.http.writeOk(
      UserHandlers.update,
      { id: created.id, changes: { lastActiveTenantId: testTenantId(999) }, version: 1 },
      systemAdmin,
    );

    const res = await stack.http.raw("POST", "/api/auth/login", {
      email: "stale@example.com",
      password: "stale-pw-1234",
    });
    const body = await res.json();

    expect(body.isSuccess).toBe(true);
    expect(body.user.tenantId).toBe(testTenantId(3));
  });
});

// --- Scenario 7b: Login rate-limit / brute-force protection ---

describe("scenario 7b: login rate limiting", () => {
  let rlStack: TestStack;

  beforeAll(async () => {
    const encryption = createEncryptionProvider(encryptionKey);
    const resolver = createConfigResolver({ encryption });
    const { createInMemoryLoginRateLimiter } = await import("@kumiko/framework/api");

    rlStack = await setupTestStack({
      features: [
        createConfigFeature(),
        createUserFeature(),
        createTenantFeature(),
        createAuthEmailPasswordFeature(),
      ],
      extraContext: { configResolver: resolver, configEncryption: encryption },
      authConfig: {
        membershipQuery: "tenant:query:memberships",
        loginHandler: AuthHandlers.login,
        loginErrorStatusMap: {
          [AuthErrors.invalidCredentials]: 401,
          [AuthErrors.noMembership]: 403,
        },
        // Tight limit so the test finishes fast: 3 attempts per small window
        loginRateLimit: createInMemoryLoginRateLimiter(3, 60_000),
      },
    });
    await createEntityTable(rlStack.db, userEntity);
    await createEntityTable(rlStack.db, tenantEntity);
    await pushTables(rlStack.db, { configValuesTable, tenantMembershipsTable });

    // Seed one real user
    const hash = await hashPassword("right-password");
    const created = await rlStack.http.writeOk<{ id: string }>(
      UserHandlers.create,
      { email: "brute@example.com", passwordHash: hash, displayName: "Brute" },
      systemAdmin,
    );
    await seedTenantMembership(rlStack.db, {
      userId: created.id,
      tenantId: "00000000-0000-4000-8000-000000000001",
      roles: ["User"],
    });
  });

  afterAll(async () => {
    await rlStack.cleanup();
  });

  test("repeated failed logins get 429 after threshold", async () => {
    // 3 wrong attempts — all 401, not yet blocked
    for (let i = 0; i < 3; i++) {
      const res = await rlStack.http.raw("POST", "/api/auth/login", {
        email: "brute@example.com",
        password: "wrong",
      });
      expect(res.status).toBe(401);
    }

    // 4th attempt is rate-limited
    const blocked = await rlStack.http.raw("POST", "/api/auth/login", {
      email: "brute@example.com",
      password: "wrong",
    });
    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body.error).toBe("rate_limited");

    // Even the CORRECT password is blocked now (attacker can't slip in
    // during a lockout window).
    const blockedCorrect = await rlStack.http.raw("POST", "/api/auth/login", {
      email: "brute@example.com",
      password: "right-password",
    });
    expect(blockedCorrect.status).toBe(429);
  });

  test("successful login resets the counter for that bucket", async () => {
    // Different email → fresh bucket (key is ip+email)
    const hash = await hashPassword("ok-password");
    const created = await rlStack.http.writeOk<{ id: string }>(
      UserHandlers.create,
      { email: "reset@example.com", passwordHash: hash, displayName: "Reset" },
      systemAdmin,
    );
    await seedTenantMembership(rlStack.db, {
      userId: created.id,
      tenantId: "00000000-0000-4000-8000-000000000001",
      roles: ["User"],
    });

    // 2 wrong attempts
    for (let i = 0; i < 2; i++) {
      await rlStack.http.raw("POST", "/api/auth/login", {
        email: "reset@example.com",
        password: "wrong",
      });
    }

    // Correct login succeeds (counter still at 2, under the limit of 3)
    const ok = await rlStack.http.raw("POST", "/api/auth/login", {
      email: "reset@example.com",
      password: "ok-password",
    });
    expect(ok.status).toBe(200);

    // After reset, 3 more wrong attempts must still pass before lockout
    for (let i = 0; i < 3; i++) {
      const res = await rlStack.http.raw("POST", "/api/auth/login", {
        email: "reset@example.com",
        password: "wrong",
      });
      expect(res.status).toBe(401);
    }
  });
});

// --- Scenario 8: JWT claims roundtrip (reserved field works end-to-end) ---

describe("scenario 8: SessionUser.claims JWT roundtrip", () => {
  test("signing a session with claims and verifying carries them through", async () => {
    const signed = await stack.jwt.sign({
      id: "11111111-0000-4000-8000-000000000042",
      tenantId: testTenantId(5),
      roles: ["User"],
      claims: { customerId: 99, scopes: ["read", "write"] },
    });

    const payload = await stack.jwt.verify(signed);
    expect(payload.sub).toBe("11111111-0000-4000-8000-000000000042");
    expect(payload.tenantId).toBe(testTenantId(5));
    expect(payload.roles).toEqual(["User"]);
    expect(payload.claims).toEqual({ customerId: 99, scopes: ["read", "write"] });
  });

  test("session without claims produces a JWT without the claims field", async () => {
    const signed = await stack.jwt.sign({
      id: "11111111-0000-4000-8000-000000000001",
      tenantId: "00000000-0000-4000-8000-000000000001",
      roles: ["User"],
    });

    const payload = await stack.jwt.verify(signed);
    expect(payload.claims).toBeUndefined();
  });
});

describe("scenario 7: cookie-auth + CSRF end-to-end", () => {
  // Full-stack proof that the cookie path from Vorarbeit A behaves correctly
  // against a real login handler + dispatcher. Unit tests cover the
  // middleware logic in isolation; this locks down the wiring.

  test("login sets both cookies and the token works via cookie transport", async () => {
    await seedLoginUser({ email: "cookie-user@example.com", password: "correct-horse" });

    const loginRes = await stack.http.raw("POST", "/api/auth/login", {
      email: "cookie-user@example.com",
      password: "correct-horse",
    });
    expect(loginRes.status).toBe(200);

    const authCookie = getSetCookieValue(loginRes, "kumiko_auth");
    const csrfCookie = getSetCookieValue(loginRes, "kumiko_csrf");
    expect(authCookie).toBeDefined();
    expect(csrfCookie).toBeDefined();

    // Query via cookie ONLY (no bearer). POST /query is state-changing from
    // the middleware's POV — same API convention as /write — so the web
    // client has to echo the csrf cookie in X-CSRF-Token on every POST.
    const queryRes = await stack.http.raw(
      "POST",
      "/api/query",
      { type: "user:query:user:me", payload: {} },
      {
        Cookie: `kumiko_auth=${authCookie}; kumiko_csrf=${csrfCookie}`,
        ...(csrfCookie ? { "X-CSRF-Token": csrfCookie } : {}),
      },
    );
    expect(queryRes.status).toBe(200);
  });

  test("state-changing request via cookie without CSRF token → 403", async () => {
    await seedLoginUser({ email: "csrf-user@example.com", password: "correct-horse" });

    const loginRes = await stack.http.raw("POST", "/api/auth/login", {
      email: "csrf-user@example.com",
      password: "correct-horse",
    });
    const authCookie = getSetCookieValue(loginRes, "kumiko_auth");
    const csrfCookie = getSetCookieValue(loginRes, "kumiko_csrf");

    // POST /write with cookie but no X-CSRF-Token → csrf-middleware blocks.
    const writeRes = await stack.http.raw(
      "POST",
      "/api/write",
      { type: "user:write:user:create", payload: {} },
      { Cookie: `kumiko_auth=${authCookie}; kumiko_csrf=${csrfCookie}` },
    );
    expect(writeRes.status).toBe(403);
    const body = await writeRes.json();
    expect(body.error?.code).toBe("csrf_token_mismatch");
  });

  test("browser auth flow: login → /me → logout → /me 401", async () => {
    // Bildet exakt den Pfad ab, den die Web-UI fährt: SessionProvider
    // ruft refresh() (→ /auth/tenants + /me), nach Login funktioniert /me,
    // nach Logout ist der Cookie weg → /me OHNE Cookie ist 401.
    await seedLoginUser({ email: "flow@example.com", password: "correct-horse" });

    const loginRes = await stack.http.raw("POST", "/api/auth/login", {
      email: "flow@example.com",
      password: "correct-horse",
    });
    expect(loginRes.status).toBe(200);
    const authCookie = getSetCookieValue(loginRes, "kumiko_auth");
    const csrfCookie = getSetCookieValue(loginRes, "kumiko_csrf");
    expect(authCookie).toBeDefined();
    expect(csrfCookie).toBeDefined();

    const cookieHeader = `kumiko_auth=${authCookie}; kumiko_csrf=${csrfCookie}`;

    // Eingeloggt: /me liefert User
    const meOk = await stack.http.raw(
      "POST",
      "/api/query",
      { type: "user:query:user:me", payload: {} },
      { Cookie: cookieHeader, ...(csrfCookie ? { "X-CSRF-Token": csrfCookie } : {}) },
    );
    expect(meOk.status).toBe(200);

    // Logout: Server muss Cookies löschen (Set-Cookie mit Max-Age=0)
    const logoutRes = await stack.http.raw(
      "POST",
      "/api/auth/logout",
      {},
      { Cookie: cookieHeader, ...(csrfCookie ? { "X-CSRF-Token": csrfCookie } : {}) },
    );
    expect(logoutRes.status).toBe(200);
    const clearedAuth = getSetCookieRaw(logoutRes, "kumiko_auth");
    const clearedCsrf = getSetCookieRaw(logoutRes, "kumiko_csrf");
    expect(clearedAuth).toMatch(/Max-Age=0/);
    expect(clearedCsrf).toMatch(/Max-Age=0/);

    // Nach Logout: kein Cookie mehr → /me ohne Cookie/Bearer = 401
    const meAfter = await stack.http.raw("POST", "/api/query", {
      type: "user:query:user:me",
      payload: {},
    });
    expect(meAfter.status).toBe(401);
  });

  test("both cookie AND bearer present → 400 ambiguous_auth", async () => {
    await seedLoginUser({ email: "ambig@example.com", password: "correct-horse" });

    const loginRes = await stack.http.raw("POST", "/api/auth/login", {
      email: "ambig@example.com",
      password: "correct-horse",
    });
    const body = await loginRes.json();
    const token = body.token;
    const authCookie = getSetCookieValue(loginRes, "kumiko_auth");

    const res = await stack.http.raw(
      "POST",
      "/api/query",
      { type: "user:query:user:me", payload: {} },
      {
        Cookie: `kumiko_auth=${authCookie}`,
        Authorization: `Bearer ${token}`,
      },
    );
    expect(res.status).toBe(400);
    const errBody = await res.json();
    expect(errBody.error?.code).toBe("ambiguous_auth");
  });
});
