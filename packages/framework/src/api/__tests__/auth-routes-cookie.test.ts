// auth-routes cookie behaviour — login sets cookies, logout clears them,
// switch-tenant rotates them, cookieSameSite controls the SameSite flag.
//
// Uses a stub Dispatcher so the tests exercise ONLY the HTTP-layer cookie
// logic — full-stack login via real loginHandler is covered by the
// auth-cookie sample integration test.

import { describe, expect, test } from "bun:test";
import { getSetCookieRaw, getSetCookies } from "@cosmicdrift/kumiko-testing/helpers";
import type { Hono } from "hono";
import { Hono as HonoCtor } from "hono";
import type { SessionUser } from "../../engine/types/index.ts";
import type { BatchResult, Dispatcher, WriteResult } from "../../pipeline/dispatcher.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import { PUBLIC_API_PATHS } from "../api-constants.ts";
import { authMiddleware } from "../auth-middleware.ts";
import { type AuthRoutesConfig, createAuthRoutes } from "../auth-routes.ts";
import { createJwtHelper } from "../jwt.ts";
import {
  AUTH_COOKIE_BASE,
  CSRF_COOKIE_BASE,
  HOST_COOKIE_PREFIX,
  resolveSessionCookies,
  sessionCookiesMiddleware,
} from "../session-cookies.ts";

const JWT_SECRET = "auth-routes-cookie-test-secret-min-32-characters";

function createStubDispatcher(overrides?: Partial<Dispatcher>): Dispatcher {
  const merged: Dispatcher = {
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
    async *stream(): AsyncGenerator<unknown> {},
    async command(): Promise<void> {},
    async batch(): Promise<BatchResult> {
      const ok: BatchResult = { isSuccess: true, results: [] };
      return ok;
    },
    async resolveAuthClaims(): Promise<Record<string, unknown>> {
      return {};
    },
    // Delegates to `merged.query` (not to a pre-override `base`) so the
    // switch-tenant test's `query` override — which answers
    // "tenant:query:memberships" — is what this sees too.
    async resolveActiveMembership(userId, tenantId) {
      const memberships = (await merged.query(
        "tenant:query:memberships",
        { userId },
        TestUsers.user,
      )) as ReadonlyArray<{
        tenantId: string;
        roles: readonly string[];
      }>;
      const membership = memberships.find((m) => m.tenantId === tenantId);
      if (!membership) {
        return { kind: "rejected", reason: "not_a_member" };
      }
      return { kind: "active", membership: { tenantId, roles: membership.roles } };
    },
    // Not exercised by these cookie-only tests.
    createMemberReader() {
      return async () => {
        throw new Error("createMemberReader not available in this stub");
      };
    },
    ...overrides,
  };
  return merged;
}

async function buildApp(
  overrides: Partial<AuthRoutesConfig> = {},
  dispatcher: Dispatcher = createStubDispatcher(),
  ttlSeconds?: number,
): Promise<{ app: Hono; validToken: string }> {
  const jwt = ttlSeconds
    ? createJwtHelper(JWT_SECRET, undefined, ttlSeconds)
    : createJwtHelper(JWT_SECRET);
  const validToken = await jwt.sign(TestUsers.user);
  const config: AuthRoutesConfig = {
    membershipQuery: "tenant:query:memberships",
    loginHandler: "auth:write:login",
    loginRateLimit: null, // don't need rate-limit interference in cookie tests
    ...overrides,
  };
  const app = new HonoCtor();
  app.use(
    "*",
    sessionCookiesMiddleware(
      resolveSessionCookies({
        secureCookies: overrides.secureCookies,
        cookieDomain: overrides.cookieDomain,
      }),
    ),
  );
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
    expect(cookies.get(AUTH_COOKIE_BASE)).toBeDefined();
    expect(cookies.get(CSRF_COOKIE_BASE)).toBeDefined();
  });

  test("cookieSameSite defaults to Lax", async () => {
    const { app } = await buildApp();
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.c", password: "pw" }),
    });
    expect(getSetCookieRaw(res, AUTH_COOKIE_BASE)).toMatch(/SameSite=Lax/i);
  });

  test("cookieSameSite: strict → SameSite=Strict flag", async () => {
    const { app } = await buildApp({ cookieSameSite: "strict" });
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.c", password: "pw" }),
    });
    expect(getSetCookieRaw(res, AUTH_COOKIE_BASE)).toMatch(/SameSite=Strict/i);
  });

  test("auth cookie is HttpOnly, csrf cookie is not", async () => {
    const { app } = await buildApp();
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.c", password: "pw" }),
    });
    expect(getSetCookieRaw(res, AUTH_COOKIE_BASE)).toMatch(/HttpOnly/i);
    expect(getSetCookieRaw(res, CSRF_COOKIE_BASE)).not.toMatch(/HttpOnly/i);
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

  test("cookie maxAge tracks the jwt helper's ttlSeconds, not a hardcoded default", async () => {
    const customTtl = 60 * 60; // 1h — distinct from the 24h default
    const { app } = await buildApp({}, undefined, customTtl);
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.c", password: "pw" }),
    });
    expect(getSetCookieRaw(res, AUTH_COOKIE_BASE)).toMatch(new RegExp(`Max-Age=${customTtl}\\b`));
    expect(getSetCookieRaw(res, CSRF_COOKIE_BASE)).toMatch(new RegExp(`Max-Age=${customTtl}\\b`));
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
    expect(getSetCookieRaw(res, AUTH_COOKIE_BASE)).toMatch(/Max-Age=0/i);
    expect(getSetCookieRaw(res, CSRF_COOKIE_BASE)).toMatch(/Max-Age=0/i);
  });
});

describe("auth-routes cookie behaviour on /auth/switch-tenant", () => {
  test("a non-string or missing tenantId is a 400 invalid_tenant, not a membership lookup", async () => {
    const { app, validToken } = await buildApp({}, createStubDispatcher({}));
    for (const body of [{}, { tenantId: null }, { tenantId: { x: 1 } }, { tenantId: "" }]) {
      const res = await app.request("/api/auth/switch-tenant", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${validToken}` },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_tenant" });
    }
  });

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
    const newAuth = cookies.get(AUTH_COOKIE_BASE);
    expect(newAuth).toBeDefined();
    expect(cookies.get(CSRF_COOKIE_BASE)).toBeDefined();
    expect(newAuth?.value).not.toBe(validToken); // new jwt
  });
});

// cookieDomain: Login on the apex must set a session readable by admin.<domain>.
// Without this option, the cookie remains host-only (no Domain attribute).
describe("auth-routes cookieDomain", () => {
  async function login(app: Hono): Promise<Response> {
    return app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.c", password: "pw" }),
    });
  }

  test("ohne cookieDomain: kein Domain-Attribut auf den Cookies", async () => {
    const { app } = await buildApp();
    const res = await login(app);
    expect(getSetCookieRaw(res, AUTH_COOKIE_BASE)).not.toMatch(/Domain=/i);
    expect(getSetCookieRaw(res, CSRF_COOKIE_BASE)).not.toMatch(/Domain=/i);
  });

  test("login: cookieDomain setzt Domain auf BEIDEN Cookies", async () => {
    const { app } = await buildApp({ cookieDomain: "example.eu" });
    const res = await login(app);
    expect(getSetCookieRaw(res, AUTH_COOKIE_BASE)).toMatch(/Domain=example\.eu/i);
    expect(getSetCookieRaw(res, CSRF_COOKIE_BASE)).toMatch(/Domain=example\.eu/i);
  });

  // As with logout, setting cookieDomain must also invalidate the host-only variant.
  // Otherwise, after deployment, the old host-only cookie can coexist with the new
  // Domain cookie, and the server may read the stale one depending on the environment.
  test("login: cookieDomain invalidiert zusätzlich die host-only-Variante", async () => {
    const { app } = await buildApp({ cookieDomain: "example.eu" });
    const raw = (await login(app)).headers.getSetCookie();
    const authCookies = raw.filter((c) => c.startsWith(`${AUTH_COOKIE_BASE}=`));
    const csrfCookies = raw.filter((c) => c.startsWith(`${CSRF_COOKIE_BASE}=`));
    // Host-only deletion: Max-Age=0 without a Domain attribute.
    expect(authCookies.some((c) => /Max-Age=0/i.test(c) && !/Domain=/i.test(c))).toBe(true);
    expect(csrfCookies.some((c) => /Max-Age=0/i.test(c) && !/Domain=/i.test(c))).toBe(true);
    // ...alongside the actual Domain cookie (with a positive Max-Age).
    expect(authCookies.some((c) => /Domain=example\.eu/i.test(c) && !/Max-Age=0/i.test(c))).toBe(
      true,
    );
  });

  test("ohne cookieDomain: KEIN zusätzlicher host-only-Delete beim Login", async () => {
    const { app } = await buildApp();
    const raw = (await login(app)).headers.getSetCookie();
    // Exactly one Set-Cookie per name; no Max-Age=0 deletion.
    expect(raw.filter((c) => c.startsWith(`${AUTH_COOKIE_BASE}=`)).length).toBe(1);
    expect(raw.some((c) => c.startsWith(`${AUTH_COOKIE_BASE}=`) && /Max-Age=0/i.test(c))).toBe(
      false,
    );
  });

  test("switch-tenant: rotierte Cookies tragen das Domain-Attribut", async () => {
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
    const { app, validToken } = await buildApp({ cookieDomain: "example.eu" }, dispatcher);
    const res = await app.request("/api/auth/switch-tenant", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${validToken}`,
      },
      body: JSON.stringify({ tenantId: otherTenant.tenantId }),
    });
    expect(res.status).toBe(200);
    expect(getSetCookieRaw(res, AUTH_COOKIE_BASE)).toMatch(/Domain=example\.eu/i);
    // CSRF cookie is rotated with the same common options as the auth cookie:
    // without a Domain attribute it would be host-only and the double-submit check could read the wrong one.
    expect(getSetCookieRaw(res, CSRF_COOKIE_BASE)).toMatch(/Domain=example\.eu/i);
  });

  test("logout löscht beide Varianten: mit Domain UND host-only", async () => {
    const { app, validToken } = await buildApp({ cookieDomain: "example.eu" });
    const res = await app.request("/api/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${validToken}` },
    });
    expect(res.status).toBe(200);
    const raw = res.headers.getSetCookie();
    const authDeletes = raw.filter(
      (c) => c.startsWith(`${AUTH_COOKIE_BASE}=`) && /Max-Age=0/i.test(c),
    );
    const csrfDeletes = raw.filter(
      (c) => c.startsWith(`${CSRF_COOKIE_BASE}=`) && /Max-Age=0/i.test(c),
    );
    // The host-only cookie from before cookieDomain was set plus the current Domain
    // variant must both be invalidated; otherwise logout does not affect the old cookie.
    expect(authDeletes.some((c) => /Domain=example\.eu/i.test(c))).toBe(true);
    expect(authDeletes.some((c) => !/Domain=/i.test(c))).toBe(true);
    expect(csrfDeletes.some((c) => /Domain=example\.eu/i.test(c))).toBe(true);
    expect(csrfDeletes.some((c) => !/Domain=/i.test(c))).toBe(true);
  });
});

describe("auth-routes __Host- cookie prefix", () => {
  const PREFIXED_AUTH = `${HOST_COOKIE_PREFIX}${AUTH_COOKIE_BASE}`;
  const PREFIXED_CSRF = `${HOST_COOKIE_PREFIX}${CSRF_COOKIE_BASE}`;

  async function login(app: Hono): Promise<Response> {
    return await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.c", password: "[REDACTED:API key param]" }),
    });
  }

  function isDeleteFor(header: string, name: string): boolean {
    return header.startsWith(`${name}=`) && /Max-Age=0/i.test(header);
  }

  test("secure without cookieDomain: prefixed names with Secure, Path=/, no Domain", async () => {
    const { app } = await buildApp({ secureCookies: true });
    const res = await login(app);
    expect(res.status).toBe(200);
    const cookies = getSetCookies(res);
    for (const name of [PREFIXED_AUTH, PREFIXED_CSRF]) {
      const raw = cookies.get(name)?.raw;
      expect(raw).toBeDefined();
      expect(raw).toMatch(/;\s*Secure/i);
      expect(raw).toMatch(/;\s*Path=\//i);
      expect(raw).not.toMatch(/Domain=/i);
    }
  });

  test("login also expires the legacy unprefixed host-only cookies", async () => {
    const { app } = await buildApp({ secureCookies: true });
    const headers = (await login(app)).headers.getSetCookie();
    for (const name of [AUTH_COOKIE_BASE, CSRF_COOKIE_BASE]) {
      const deletes = headers.filter((h) => isDeleteFor(h, name));
      expect(deletes).toHaveLength(1);
      expect(deletes[0]).not.toMatch(/Domain=/i);
    }
  });

  test("with cookieDomain the names stay unprefixed even when secure", async () => {
    const { app } = await buildApp({ secureCookies: true, cookieDomain: "example.eu" });
    const cookies = getSetCookies(await login(app));
    expect(cookies.get(AUTH_COOKIE_BASE)?.raw).toMatch(/Domain=example\.eu/i);
    expect(cookies.get(CSRF_COOKIE_BASE)?.raw).toMatch(/Domain=example\.eu/i);
    // Only the expiry of a __Host- leftover from an earlier config may carry the prefixed names.
    for (const name of [PREFIXED_AUTH, PREFIXED_CSRF]) {
      expect(cookies.get(name)?.value).toBe("");
      expect(cookies.get(name)?.raw).toMatch(/Max-Age=0/i);
    }
  });

  test("without Secure the names stay unprefixed", async () => {
    const { app } = await buildApp({ secureCookies: false });
    const cookies = getSetCookies(await login(app));
    expect(cookies.get(AUTH_COOKIE_BASE)?.value).not.toBe("");
    // The __Host- name only appears as an expiry of a leftover from an earlier secure config.
    expect(cookies.get(PREFIXED_AUTH)?.value).toBe("");
    expect(cookies.get(PREFIXED_AUTH)?.raw).toMatch(/Max-Age=0/i);
  });

  test("retired domains are deleted under the unprefixed names only", async () => {
    const { app } = await buildApp({ secureCookies: true, retiredCookieDomains: ["old.example"] });
    const headers = (await login(app)).headers.getSetCookie();
    const retiredDeletes = headers.filter((h) => /Domain=old\.example/i.test(h));
    expect(retiredDeletes).toHaveLength(2);
    expect(retiredDeletes.every((h) => !h.startsWith(HOST_COOKIE_PREFIX))).toBe(true);
  });

  test("logout with the prefixed cookie clears prefixed and legacy names; prefixed deletes stay Secure + Path=/", async () => {
    const { app, validToken } = await buildApp({ secureCookies: true });
    const res = await app.request("/api/auth/logout", {
      method: "POST",
      headers: { Cookie: `${PREFIXED_AUTH}=${validToken}` },
    });
    expect(res.status).toBe(200);
    const headers = res.headers.getSetCookie();
    for (const name of [PREFIXED_AUTH, PREFIXED_CSRF]) {
      const deletes = headers.filter((h) => isDeleteFor(h, name));
      expect(deletes).toHaveLength(1);
      expect(deletes[0]).toMatch(/;\s*Secure/i);
      expect(deletes[0]).toMatch(/;\s*Path=\//i);
      expect(deletes[0]).not.toMatch(/Domain=/i);
    }
    for (const name of [AUTH_COOKIE_BASE, CSRF_COOKIE_BASE]) {
      expect(headers.filter((h) => isDeleteFor(h, name))).toHaveLength(1);
    }
  });

  test("a request carrying only the legacy auth cookie is not authenticated", async () => {
    const { app, validToken } = await buildApp({ secureCookies: true });
    const res = await app.request("/api/auth/logout", {
      method: "POST",
      headers: { Cookie: `${AUTH_COOKIE_BASE}=${validToken}` },
    });
    expect(res.status).toBe(401);
  });

  test("the prefixed auth cookie authenticates", async () => {
    const { app, validToken } = await buildApp({ secureCookies: true });
    const res = await app.request("/api/auth/logout", {
      method: "POST",
      headers: { Cookie: `${PREFIXED_AUTH}=${validToken}` },
    });
    expect(res.status).toBe(200);
  });
});

describe("auth-routes retiredCookieDomains validation", () => {
  const buildWith = (retired: readonly string[], cookieDomain?: string) => () =>
    createAuthRoutes(createStubDispatcher(), createJwtHelper(JWT_SECRET), {
      membershipQuery: "tenant:query:memberships",
      loginHandler: "auth:write:login",
      ...(cookieDomain !== undefined && { cookieDomain }),
      retiredCookieDomains: retired,
    });

  test.each([
    ["empty", ""],
    ["lone dot", "."],
    ["semicolon", "a.com; Path=/"],
    ["comma", "a.com,b.com"],
    ["space", "a .com"],
    ["tab", "a\t.com"],
    ["CR", "a.com\r"],
    ["LF", "a.com\nSet-Cookie: x=y"],
  ])("rejects an entry that is %s", (_label, entry) => {
    expect(buildWith([entry])).toThrow(/retiredCookieDomains/);
  });

  test("rejects an entry equal to cookieDomain (case-insensitive, leading dot ignored)", () => {
    expect(buildWith([".Example.EU"], "example.eu")).toThrow(/equals cookieDomain/);
  });

  test("accepts valid entries different from cookieDomain", () => {
    expect(buildWith(["old.example.eu", ".other.eu"], "example.eu")).not.toThrow();
  });
});
