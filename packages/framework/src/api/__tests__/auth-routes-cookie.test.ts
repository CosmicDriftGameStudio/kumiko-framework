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
import { PUBLIC_API_PATHS } from "../api-constants";
import { AUTH_COOKIE_NAME, authMiddleware, CSRF_COOKIE_NAME } from "../auth-middleware";
import { type AuthRoutesConfig, createAuthRoutes } from "../auth-routes";
import { createJwtHelper } from "../jwt";

const JWT_SECRET = "auth-routes-cookie-test-secret-min-32-characters";

function createStubDispatcher(overrides?: Partial<Dispatcher>): Dispatcher {
  const base: Dispatcher = {
    async write(): Promise<WriteResult> {
      return {
        isSuccess: true,
        data: {
          kind: "auth-session",
          session: TestUsers.user,
        },
      } as WriteResult;
    },
    async query(): Promise<unknown> {
      return [];
    },
    async command(): Promise<void> {},
    async batch(): Promise<BatchResult> {
      return { isSuccess: true, results: [] } as BatchResult;
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

function parseSetCookies(res: Response): Record<string, string> {
  // hono/cookie emits each Set-Cookie separately; Node aggregates them
  // onto one header joined by ", " which breaks naive `split(",")`
  // because "Expires" includes a comma. Here we only need the first
  // segment (name=value) of each cookie, so split by "; " and look at
  // the first token of each ", "-separated piece cautiously.
  const header = res.headers.get("set-cookie") ?? "";
  const out: Record<string, string> = {};
  // Hono's test runtime exposes getSetCookie() on the underlying Response;
  // when available use it — it returns each cookie as its own string.
  const getSetCookie = (res.headers as { getSetCookie?: () => string[] }).getSetCookie;
  const cookies = getSetCookie ? getSetCookie.call(res.headers) : [header];
  for (const c of cookies) {
    const first = c.split(";")[0];
    if (!first) continue;
    const eq = first.indexOf("=");
    if (eq === -1) continue;
    out[first.slice(0, eq).trim()] = first.slice(eq + 1).trim();
  }
  return out;
}

function setCookieStringFor(res: Response, name: string): string | undefined {
  const getSetCookie = (res.headers as { getSetCookie?: () => string[] }).getSetCookie;
  const cookies = getSetCookie
    ? getSetCookie.call(res.headers)
    : [res.headers.get("set-cookie") ?? ""];
  return cookies.find((c) => c.startsWith(`${name}=`));
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
    const cookies = parseSetCookies(res);
    expect(cookies[AUTH_COOKIE_NAME]).toBeTruthy();
    expect(cookies[CSRF_COOKIE_NAME]).toBeTruthy();
  });

  test("cookieSameSite defaults to Lax", async () => {
    const { app } = await buildApp();
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.c", password: "pw" }),
    });
    const raw = setCookieStringFor(res, AUTH_COOKIE_NAME);
    expect(raw).toMatch(/SameSite=Lax/i);
  });

  test("cookieSameSite: strict → SameSite=Strict flag", async () => {
    const { app } = await buildApp({ cookieSameSite: "strict" });
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.c", password: "pw" }),
    });
    const raw = setCookieStringFor(res, AUTH_COOKIE_NAME);
    expect(raw).toMatch(/SameSite=Strict/i);
  });

  test("auth cookie is HttpOnly, csrf cookie is not", async () => {
    const { app } = await buildApp();
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.c", password: "pw" }),
    });
    const authRaw = setCookieStringFor(res, AUTH_COOKIE_NAME);
    const csrfRaw = setCookieStringFor(res, CSRF_COOKIE_NAME);
    expect(authRaw).toMatch(/HttpOnly/i);
    expect(csrfRaw).not.toMatch(/HttpOnly/i);
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
    const authRaw = setCookieStringFor(res, AUTH_COOKIE_NAME);
    const csrfRaw = setCookieStringFor(res, CSRF_COOKIE_NAME);
    expect(authRaw).toMatch(/Max-Age=0/i);
    expect(csrfRaw).toMatch(/Max-Age=0/i);
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
    const cookies = parseSetCookies(res);
    expect(cookies[AUTH_COOKIE_NAME]).toBeTruthy();
    expect(cookies[CSRF_COOKIE_NAME]).toBeTruthy();
    expect(cookies[AUTH_COOKIE_NAME]).not.toBe(validToken); // new jwt
  });
});
