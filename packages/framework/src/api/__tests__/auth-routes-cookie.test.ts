// auth-routes cookie behaviour — login sets cookies, logout clears them,
// switch-tenant rotates them, cookieSameSite controls the SameSite flag.
//
// Uses a stub Dispatcher so the tests exercise ONLY the HTTP-layer cookie
// logic — full-stack login via real loginHandler is covered by the
// auth-cookie sample integration test.

import type { Hono } from "hono";
import { Hono as HonoCtor } from "hono";
import { describe, expect, test } from "vitest";
import type { SessionUser } from "../../engine/types";
import type { BatchResult, Dispatcher, WriteResult } from "../../pipeline/dispatcher";
import { TestUsers } from "../../testing/fixtures";
import { getSetCookieRaw, getSetCookies } from "../../testing/http-cookies";
import { PUBLIC_API_PATHS } from "../api-constants";
import { AUTH_COOKIE_NAME, authMiddleware, CSRF_COOKIE_NAME } from "../auth-middleware";
import { type AuthRoutesConfig, createAuthRoutes } from "../auth-routes";
import { createJwtHelper } from "../jwt";

const JWT_SECRET = "auth-routes-cookie-test-secret-min-32-characters";

function createStubDispatcher(overrides?: Partial<Dispatcher>): Dispatcher {
  const base: Dispatcher = {
    async write(): Promise<WriteResult> {
      // Explicit `const: WriteResult` locks the `isSuccess: true` branch of
      // the union without an `as`-cast (which widens + silences the
      // compiler). Success shape has to satisfy `{ isSuccess: true; data }`.
      const ok: WriteResult = {
        isSuccess: true,
        data: {
          kind: "auth-session",
          session: TestUsers.user,
        },
      };
      return ok;
    },
    async query(): Promise<unknown> {
      return [];
    },
    async command(): Promise<void> {},
    async batch(): Promise<BatchResult> {
      const ok: BatchResult = { isSuccess: true, results: [] };
      return ok;
    },
    async resolveAuthClaims(): Promise<Record<string, unknown>> {
      return {};
    },
  };
  return { ...base, ...overrides };
}

async function buildApp(
  overrides: Partial<AuthRoutesConfig> = {},
  dispatcher: Dispatcher = createStubDispatcher(),
): Promise<{ app: Hono; validToken: string }> {
  const jwt = createJwtHelper(JWT_SECRET);
  const validToken = await jwt.sign(TestUsers.user);
  const config: AuthRoutesConfig = {
    membershipQuery: "tenant:query:memberships",
    loginHandler: "auth:write:login",
    loginRateLimit: null, // don't need rate-limit interference in cookie tests
    ...overrides,
  };
  const app = new HonoCtor();
  const jwtGuard = authMiddleware(jwt);
  app.use("/api/*", async (c, next) => {
    if (PUBLIC_API_PATHS.has(c.req.path)) return next();
    return jwtGuard(c, next);
  });
  app.route("/api", createAuthRoutes(dispatcher, jwt, config));
  return { app, validToken };
}

describe("auth-routes cookie behaviour on /auth/login", () => {
  test("login sets both kumiko_auth and kumiko_csrf cookies", async () => {
    const { app } = await buildApp();
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.c", password: "pw" }),
    });
    expect(res.status).toBe(200);
    const cookies = getSetCookies(res);
    expect(cookies.get(AUTH_COOKIE_NAME)).toBeDefined();
    expect(cookies.get(CSRF_COOKIE_NAME)).toBeDefined();
  });

  test("cookieSameSite defaults to Lax", async () => {
    const { app } = await buildApp();
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.c", password: "pw" }),
    });
    expect(getSetCookieRaw(res, AUTH_COOKIE_NAME)).toMatch(/SameSite=Lax/i);
  });

  test("cookieSameSite: strict → SameSite=Strict flag", async () => {
    const { app } = await buildApp({ cookieSameSite: "strict" });
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.c", password: "pw" }),
    });
    expect(getSetCookieRaw(res, AUTH_COOKIE_NAME)).toMatch(/SameSite=Strict/i);
  });

  test("auth cookie is HttpOnly, csrf cookie is not", async () => {
    const { app } = await buildApp();
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.c", password: "pw" }),
    });
    expect(getSetCookieRaw(res, AUTH_COOKIE_NAME)).toMatch(/HttpOnly/i);
    expect(getSetCookieRaw(res, CSRF_COOKIE_NAME)).not.toMatch(/HttpOnly/i);
  });

  test("login still returns token in body (for native bearer clients)", async () => {
    const { app } = await buildApp();
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.c", password: "pw" }),
    });
    const body = (await res.json()) as { isSuccess: boolean; token: string };
    expect(body.isSuccess).toBe(true);
    expect(typeof body.token).toBe("string");
    expect(body.token.length).toBeGreaterThan(20);
  });
});

describe("auth-routes cookie behaviour on /auth/logout", () => {
  test("logout clears both cookies via Max-Age=0", async () => {
    const { app, validToken } = await buildApp();
    const res = await app.request("/api/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${validToken}` },
    });
    expect(res.status).toBe(200);
    expect(getSetCookieRaw(res, AUTH_COOKIE_NAME)).toMatch(/Max-Age=0/i);
    expect(getSetCookieRaw(res, CSRF_COOKIE_NAME)).toMatch(/Max-Age=0/i);
  });
});

describe("auth-routes cookie behaviour on /auth/switch-tenant", () => {
  test("switch-tenant rotates both cookies", async () => {
    const otherTenant = TestUsers.otherTenant;
    const dispatcher = createStubDispatcher({
      async query(type: string, _payload: unknown, _user: SessionUser): Promise<unknown> {
        if (type === "tenant:query:memberships") {
          return [
            {
              userId: TestUsers.user.id,
              tenantId: otherTenant.tenantId,
              roles: otherTenant.roles,
            },
          ];
        }
        return [];
      },
    });
    const { app, validToken } = await buildApp({}, dispatcher);
    const res = await app.request("/api/auth/switch-tenant", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${validToken}`,
      },
      body: JSON.stringify({ tenantId: otherTenant.tenantId }),
    });
    expect(res.status).toBe(200);
    const cookies = getSetCookies(res);
    const newAuth = cookies.get(AUTH_COOKIE_NAME);
    expect(newAuth).toBeDefined();
    expect(cookies.get(CSRF_COOKIE_NAME)).toBeDefined();
    expect(newAuth?.value).not.toBe(validToken); // new jwt
  });
});
