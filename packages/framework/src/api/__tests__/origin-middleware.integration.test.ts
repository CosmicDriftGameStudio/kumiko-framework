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
import { setupTestStack, type TestStack, TestUsers } from "../../stack";
import { AUTH_COOKIE_NAME, CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "../auth-middleware";

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
