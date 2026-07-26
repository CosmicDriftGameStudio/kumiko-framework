// kumiko-framework#1539: `trustedProxyHops` on AuthRoutesConfig. Verifies
// the client-IP derivation behind /auth/mfa/verify's rate limiter — chosen
// because it keys on bare IP (no email composite), so a wrong default here
// is a shared-bucket DoS, not just a spoofing hole. Real Hono app + real
// in-memory rate limiter, HTTP requests with attacker-shaped headers — no
// fake dispatcher.

import { describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { Hono as HonoCtor } from "hono";
import { UnprocessableError } from "../../errors";
import type { BatchResult, Dispatcher, WriteResult } from "../../pipeline/dispatcher";
import { PUBLIC_API_PATHS } from "../api-constants";
import { authMiddleware } from "../auth-middleware";
import {
  type AuthRoutesConfig,
  createAuthRoutes,
  createInMemoryLoginRateLimiter,
} from "../auth-routes";
import { createJwtHelper } from "../jwt";

const JWT_SECRET = "test-secret-at-least-32-bytes-long-for-hs256";
const MFA_VERIFY_QN = "auth-mfa:write:verify";

function failingDispatcher(): Dispatcher {
  return {
    async write(): Promise<WriteResult> {
      return { isSuccess: false, error: new UnprocessableError("invalid_totp_code") };
    },
    async query(): Promise<unknown> {
      return [];
    },
    async *stream(): AsyncGenerator<unknown> {},
    async command(): Promise<void> {},
    async batch(): Promise<BatchResult> {
      return { isSuccess: true, results: [] };
    },
    async resolveAuthClaims(): Promise<Record<string, unknown>> {
      return {};
    },
  };
}

async function buildApp(overrides: Partial<AuthRoutesConfig> = {}): Promise<Hono> {
  const jwt = createJwtHelper(JWT_SECRET);
  const config: AuthRoutesConfig = {
    membershipQuery: "tenant:query:memberships",
    mfaVerifyHandler: MFA_VERIFY_QN,
    mfaVerifyRateLimit: createInMemoryLoginRateLimiter(2, 60_000),
    ...overrides,
  };
  const app = new HonoCtor();
  const jwtGuard = authMiddleware(jwt);
  app.use("/api/*", async (c, next) => {
    if (PUBLIC_API_PATHS.has(c.req.path)) return next();
    return jwtGuard(c, next);
  });
  app.route("/api", createAuthRoutes(failingDispatcher(), jwt, config));
  return app;
}

function verifyRequest(xForwardedFor?: string, xRealIp?: string): Request {
  return new Request("http://localhost/api/auth/mfa/verify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(xForwardedFor !== undefined ? { "x-forwarded-for": xForwardedFor } : {}),
      ...(xRealIp !== undefined ? { "x-real-ip": xRealIp } : {}),
    },
    body: JSON.stringify({ challengeToken: "t", code: "000000" }),
  });
}

describe("AuthRoutesConfig.trustedProxyHops", () => {
  test("rejects a negative trustedProxyHops at construction — fails loud, not into a shared bucket", async () => {
    await expect(buildApp({ trustedProxyHops: -1 })).rejects.toThrow(/non-negative integer/);
  });

  test("rejects a non-integer trustedProxyHops at construction", async () => {
    await expect(buildApp({ trustedProxyHops: 1.5 })).rejects.toThrow(/non-negative integer/);
  });

  test("hops=1: an attacker rotating the untrusted XFF prefix still hits the real client's bucket", async () => {
    const app = await buildApp({ trustedProxyHops: 1 });
    // nginx-style append: "<attacker-claim>, <real-client-as-seen-by-nginx>"
    // — attacker rotates the left entry per request, last entry stays fixed.
    const attempt = (n: number) => app.request(verifyRequest(`1.2.3.${n}, 9.9.9.9`));
    expect((await attempt(1)).status).toBe(422);
    expect((await attempt(2)).status).toBe(422);
    const third = await attempt(3);
    expect(third.status).toBe(429);
  });

  test("hops=1: two genuinely different clients (differing last entry) get independent buckets", async () => {
    const app = await buildApp({ trustedProxyHops: 1 });
    const clientA = () => app.request(verifyRequest("fake, 9.9.9.9"));
    const clientB = () => app.request(verifyRequest("fake, 8.8.8.8"));
    expect((await clientA()).status).toBe(422);
    expect((await clientA()).status).toBe(422);
    expect((await clientA()).status).toBe(429);
    // client B is unaffected by client A's cap
    expect((await clientB()).status).toBe(422);
  });

  test("hops=0 (default): legacy behavior — trusts the first XFF entry unconditionally", async () => {
    const app = await buildApp();
    // No override: two "different" first-entries mean two different buckets,
    // even though both requests carry the same real backend hop.
    const clientA = () => app.request(verifyRequest("1.1.1.1, 9.9.9.9"));
    const clientB = () => app.request(verifyRequest("2.2.2.2, 9.9.9.9"));
    expect((await clientA()).status).toBe(422);
    expect((await clientA()).status).toBe(422);
    expect((await clientA()).status).toBe(429);
    expect((await clientB()).status).toBe(422);
  });

  test("hops=2 with a shorter XFF chain than configured collapses distinct clients into the unknown bucket", async () => {
    const app = await buildApp({ trustedProxyHops: 2 });
    // Only 1 entry present but 2 hops configured — chain shorter than
    // expected. Two DIFFERENT single-entry values must still share the cap:
    // proves the short chain was rejected into "unknown" rather than
    // extracted per-request (a same-value-only assertion would also pass
    // for a constant return).
    const attempt = (xff: string) => app.request(verifyRequest(xff));
    expect((await attempt("9.9.9.9")).status).toBe(422);
    expect((await attempt("7.7.7.7")).status).toBe(422);
    const third = await attempt("6.6.6.6");
    expect(third.status).toBe(429);
  });

  test("hops=1 with no XFF and no X-Real-IP collapses distinct clients into unknown", async () => {
    const app = await buildApp({ trustedProxyHops: 1 });
    // Three requests without either header must share the "unknown" bucket —
    // a single 422 only proves "no throw", not the collapse (fw#1555#2).
    const attempt = () => app.request(verifyRequest(undefined));
    expect((await attempt()).status).toBe(422);
    expect((await attempt()).status).toBe(422);
    expect((await attempt()).status).toBe(429);
  });

  test("hops=1 with short/missing XFF uses x-real-ip so clients stay independent", async () => {
    const app = await buildApp({ trustedProxyHops: 1 });
    const attempt = (realIp: string) => app.request(verifyRequest(undefined, realIp));
    expect((await attempt("203.0.113.10")).status).toBe(422);
    expect((await attempt("203.0.113.10")).status).toBe(422);
    expect((await attempt("203.0.113.10")).status).toBe(429);
    // Different X-Real-IP must not share the previous client's bucket.
    expect((await attempt("203.0.113.11")).status).toBe(422);
  });
});
