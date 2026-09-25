// origin-middleware wired into the real buildServer pipeline. Proves that the
// registration fires when authConfig.allowedOrigins is set, that the guard sits
// BEFORE the CSRF guard (a disallowed cross-site POST surfaces as
// `origin_not_allowed`, not `csrf_token_mismatch`), that cookie-vs-bearer
// transport detection works end-to-end, and that the explicit opt-out disables
// the guard without breaking boot. Cookie-auth is forged with a minted JWT — no
// full login flow needed to exercise the guard. Passing requests hit the
// dispatcher and 404 on the unknown query, which positively proves no guard
// rejected them (guards return 403).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as z from "zod";
import { defineFeature } from "../../engine";
import { setupTestStack, type TestStack, TestUsers } from "../../stack";
import { AUTH_COOKIE_NAME, CSRF_COOKIE_NAME, CSRF_HEADER_NAME, getUser } from "../auth-middleware";

const ALLOWED = "https://admin.example.eu";
const DISALLOWED = "https://tenant.example.eu";
const QUERY_BODY = { type: "noop:query:noop", payload: {} };

async function errorCode(res: Response): Promise<string | undefined> {
  const body = (await res.json().catch(() => ({}))) as { error?: { code?: string } };
  return body.error?.code;
}

describe("origin-middleware (integration)", () => {
  let stack: TestStack;
  let authCookie: string;

  beforeAll(async () => {
    stack = await setupTestStack({
      features: [],
      authConfig: {
        // Never dispatched here — present only so options.auth is wired and the
        // Origin guard registers. switch-tenant is the only consumer.
        membershipQuery: "tenant:query:memberships",
        allowedOrigins: [ALLOWED],
        cookieDomain: "example.eu",
      },
    });
    const token = await stack.jwt.sign(TestUsers.user);
    authCookie = `${AUTH_COOKIE_NAME}=${token}`;
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("disallowed origin + simple text/plain POST → 403 origin_not_allowed (before CSRF)", async () => {
    const res = await stack.http.raw("POST", "/api/query", QUERY_BODY, {
      Cookie: authCookie,
      Origin: DISALLOWED,
      "Content-Type": "text/plain",
    });
    expect(res.status).toBe(403);
    // No CSRF token sent — proves the Origin guard runs FIRST (else this would
    // be csrf_token_mismatch).
    expect(await errorCode(res)).toBe("origin_not_allowed");
  });

  test("allowed origin (no CSRF token) → falls through to the CSRF guard", async () => {
    const res = await stack.http.raw("POST", "/api/query", QUERY_BODY, {
      Cookie: authCookie,
      Origin: ALLOWED,
    });
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("csrf_token_mismatch");
  });

  test("no Origin + valid CSRF token → reaches dispatcher (Safari same-origin POST)", async () => {
    const csrf = "csrf-fixed-integration-token";
    const res = await stack.http.raw("POST", "/api/query", QUERY_BODY, {
      Cookie: `${authCookie}; ${CSRF_COOKIE_NAME}=${csrf}`,
      [CSRF_HEADER_NAME]: csrf,
    });
    // Both guards passed → the dispatcher 404s the unknown query. A positive
    // assertion proves no guard (403) rejected the request.
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("not_found");
  });

  test("no Origin + Sec-Fetch-Site: cross-site → 403 origin_not_allowed", async () => {
    const res = await stack.http.raw("POST", "/api/query", QUERY_BODY, {
      Cookie: authCookie,
      "Sec-Fetch-Site": "cross-site",
    });
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("origin_not_allowed");
  });

  test("bearer transport + disallowed origin → skips both guards, reaches dispatcher", async () => {
    const token = await stack.jwt.sign(TestUsers.user);
    const res = await stack.http.raw("POST", "/api/query", QUERY_BODY, {
      Authorization: `Bearer ${token}`,
      Origin: DISALLOWED,
    });
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("not_found");
  });
});

describe("origin-middleware opt-out (unsafeSkipOriginCheck)", () => {
  let stack: TestStack;
  let authCookie: string;

  beforeAll(async () => {
    // cookieDomain set WITHOUT allowedOrigins would normally fail-closed; the
    // explicit opt-out must let it boot AND leave the guard unregistered.
    stack = await setupTestStack({
      features: [],
      authConfig: {
        membershipQuery: "tenant:query:memberships",
        cookieDomain: "example.eu",
        unsafeSkipOriginCheck: true,
      },
    });
    const token = await stack.jwt.sign(TestUsers.user);
    authCookie = `${AUTH_COOKIE_NAME}=${token}`;
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("guard not registered → disallowed origin falls through to CSRF, not origin-blocked", async () => {
    const res = await stack.http.raw("POST", "/api/query", QUERY_BODY, {
      Cookie: authCookie,
      Origin: DISALLOWED,
    });
    expect(res.status).toBe(403);
    // CSRF fires (no token) — NOT the origin guard. Proves the opt-out disabled it.
    expect(await errorCode(res)).toBe("csrf_token_mismatch");
  });
});

// The "without anonymousAccess" case (disallowed origin → 403) is already
// covered above by the first describe block's server config, minus
// anonymousAccess — not repeated here.
const anonEchoQuery = { type: "origin-anon-probe:query:anon-echo", payload: {} };
const userOnlyRoute = { type: "origin-anon-probe:write:user-only", payload: {} };
const probeFeature = defineFeature("origin-anon-probe", (r) => {
  r.queryHandler({
    name: "anon-echo",
    schema: z.object({}),
    access: { roles: ["anonymous"] },
    handler: async (event) => ({ userId: event.user.id, roles: event.user.roles }),
  });
  r.writeHandler({
    name: "user-only",
    schema: z.object({}),
    access: { roles: ["User"] },
    handler: async (event) => ({
      isSuccess: true as const,
      data: { userId: event.user.id, roles: event.user.roles },
    }),
  });
  // anonymous:false httpRoutes can't live under /api/* — the boot validator
  // (feature-ui-extensions.ts) hard-blocks that path prefix for every
  // feature route, so this is mounted outside /api/* and guarded by
  // sessionOnlyHttpRouteGuards (sessionOnlyGuard, no foreignCookieOrigins
  // downgrade) instead of the /api/* jwtGuard used above.
  r.httpRoute({
    method: "POST",
    path: "/origin-anon-probe-http",
    anonymous: false,
    handler: async (c) => c.json({ id: getUser(c).id }),
  });
});

describe("origin-middleware + anonymousAccess: foreign-origin cookie becomes anonymous", () => {
  let stack: TestStack;
  let authCookie: string;

  beforeAll(async () => {
    stack = await setupTestStack({
      features: [probeFeature],
      authConfig: {
        membershipQuery: "tenant:query:memberships",
        allowedOrigins: [ALLOWED],
        cookieDomain: "example.eu",
      },
      anonymousAccess: { defaultTenantId: TestUsers.user.tenantId },
    });
    const token = await stack.jwt.sign(TestUsers.user);
    authCookie = `${AUTH_COOKIE_NAME}=${token}`;
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("foreign origin + cookie, no CSRF token → handler runs as the anonymous user", async () => {
    const res = await stack.http.raw("POST", "/api/query", anonEchoQuery, {
      Cookie: authCookie,
      Origin: DISALLOWED,
    });
    // 200 (not csrf_token_mismatch) proves CSRF wasn't required — authTransport
    // stayed unset — and the echoed identity is the synthesised anonymous
    // user, not the cookie's real one.
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { userId: string; roles: readonly string[] } };
    expect(body.data.userId).toBe("anonymous");
    expect(body.data.roles).toEqual(["anonymous"]);
  });

  test("foreign origin + garbage cookie value → still anonymous, jwt.verify never runs", async () => {
    const res = await stack.http.raw("POST", "/api/query", anonEchoQuery, {
      Cookie: `${AUTH_COOKIE_NAME}=not-a-valid-jwt`,
      Origin: DISALLOWED,
    });
    // A malformed token would 401 invalid_token if jwt.verify ran on it —
    // 200 here is only possible if the cookie was dropped unread.
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { userId: string } };
    expect(body.data.userId).toBe("anonymous");
  });

  test("/api/auth/logout from a foreign origin → still 403 origin_not_allowed, not silently anonymous", async () => {
    const res = await stack.http.raw(
      "POST",
      "/api/auth/logout",
      {},
      {
        Cookie: authCookie,
        Origin: DISALLOWED,
      },
    );
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("origin_not_allowed");
  });

  test("allowed origin + cookie, no CSRF token → real user path still requires CSRF", async () => {
    const res = await stack.http.raw("POST", "/api/write", userOnlyRoute, {
      Cookie: authCookie,
      Origin: ALLOWED,
    });
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("csrf_token_mismatch");
  });

  test("allowed origin + cookie + valid CSRF → authenticated as the real user, not anonymous", async () => {
    const csrf = "csrf-fixed-anon-fallthrough-token";
    const res = await stack.http.raw("POST", "/api/write", userOnlyRoute, {
      Cookie: `${authCookie}; ${CSRF_COOKIE_NAME}=${csrf}`,
      Origin: ALLOWED,
      [CSRF_HEADER_NAME]: csrf,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { userId: string; roles: readonly string[] } };
    expect(body.data.userId).toBe(TestUsers.user.id);
    expect(body.data.roles).toEqual(TestUsers.user.roles);
  });

  test("anonymous:false r.httpRoute, foreign origin + cookie, no CSRF → 403 origin_not_allowed, sessionOnlyGuard does not downgrade to anonymous", async () => {
    // /api/* would downgrade a foreign-origin cookie to anonymous (see the
    // anon-echo tests above) because jwtGuard carries foreignCookieOrigins.
    // r.httpRoute anonymous:false routes run behind sessionOnlyGuard instead,
    // which was deliberately built WITHOUT anonymousAccess/foreignCookieOrigins
    // — a real cookie must still resolve to the real user, so the Origin guard
    // rejects it outright instead of silently falling through anonymous.
    const res = await stack.http.raw(
      "POST",
      "/origin-anon-probe-http",
      {},
      {
        Cookie: authCookie,
        Origin: DISALLOWED,
      },
    );
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("origin_not_allowed");
  });
});
