// origin-middleware wired into the real buildServer pipeline. Proves that the
// opt-in registration fires when authConfig.allowedOrigins is set, that the
// guard sits BEFORE the CSRF guard (a disallowed cross-site POST surfaces as
// `origin_not_allowed`, not `csrf_token_mismatch`), and that cookie-vs-bearer
// transport detection works end-to-end. Cookie-auth is forged with a minted
// JWT — no full login flow needed to exercise the guard.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { setupTestStack, type TestStack, TestUsers } from "../../stack";
import { AUTH_COOKIE_NAME, CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "../auth-middleware";

const ALLOWED = "https://admin.example.eu";
const DISALLOWED = "https://tenant.example.eu";
const QUERY_BODY = { type: "noop:query:noop", payload: {} };

let stack: TestStack;
let authCookie: string;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [],
    authConfig: {
      // Never dispatched here — present only so options.auth is wired and the
      // opt-in Origin guard registers. switch-tenant is the only consumer.
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

async function errorCode(res: Response): Promise<string | undefined> {
  const body = (await res.json().catch(() => ({}))) as { error?: { code?: string } };
  return body.error?.code;
}

describe("origin-middleware (integration)", () => {
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

  test("allowed origin (no CSRF token) → falls through to CSRF guard", async () => {
    const res = await stack.http.raw("POST", "/api/query", QUERY_BODY, {
      Cookie: authCookie,
      Origin: ALLOWED,
    });
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("csrf_token_mismatch");
  });

  test("no Origin + valid CSRF token → guard passes (Safari same-origin POST)", async () => {
    const csrf = "csrf-fixed-integration-token";
    const res = await stack.http.raw("POST", "/api/query", QUERY_BODY, {
      Cookie: `${authCookie}; ${CSRF_COOKIE_NAME}=${csrf}`,
      [CSRF_HEADER_NAME]: csrf,
    });
    // Reaches the dispatcher (unknown handler) — must NOT be blocked by either guard.
    const code = await errorCode(res);
    expect(code).not.toBe("origin_not_allowed");
    expect(code).not.toBe("csrf_token_mismatch");
  });

  test("no Origin + Sec-Fetch-Site: cross-site → 403 origin_not_allowed", async () => {
    const res = await stack.http.raw("POST", "/api/query", QUERY_BODY, {
      Cookie: authCookie,
      "Sec-Fetch-Site": "cross-site",
    });
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("origin_not_allowed");
  });

  test("bearer transport + disallowed origin → guard skips (no false-positive for mobile)", async () => {
    const token = await stack.jwt.sign(TestUsers.user);
    const res = await stack.http.raw("POST", "/api/query", QUERY_BODY, {
      Authorization: `Bearer ${token}`,
      Origin: DISALLOWED,
    });
    expect(await errorCode(res)).not.toBe("origin_not_allowed");
  });
});
