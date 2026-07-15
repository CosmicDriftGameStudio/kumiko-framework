// auth-routes /auth/mfa/verify — framework-level route mechanics only:
// body validation, dispatch-and-mint-on-success, its OWN rate limiter
// (mfaVerifyRateLimit, distinct from loginRateLimit), and error-status
// mapping. Uses a stub Dispatcher with a fake mfaVerifyHandler — the REAL
// challenge-token verification / TOTP check / brute-force cap lives in
// auth-mfa's own handler and is covered there, not here.

import { describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { Hono as HonoCtor } from "hono";
import { InternalError, UnprocessableError } from "../../errors";
import type { BatchResult, Dispatcher, WriteResult } from "../../pipeline/dispatcher";
import { TestUsers } from "../../stack";
import { getSetCookies } from "../../testing/http-cookies";
import { PUBLIC_API_PATHS } from "../api-constants";
import { AUTH_COOKIE_NAME, authMiddleware, CSRF_COOKIE_NAME } from "../auth-middleware";
import {
  type AuthRoutesConfig,
  createAuthRoutes,
  createInMemoryLoginRateLimiter,
} from "../auth-routes";
import { createJwtHelper } from "../jwt";

const JWT_SECRET = "auth-routes-mfa-verify-test-secret-min-32-characters";
const MFA_VERIFY_QN = "auth-mfa:write:verify";

function createStubDispatcher(overrides?: Partial<Dispatcher>): Dispatcher {
  const base: Dispatcher = {
    async write(): Promise<WriteResult> {
      const ok: WriteResult = {
        isSuccess: true,
        data: { kind: "mfa-verify-success", session: TestUsers.user },
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
): Promise<{ app: Hono }> {
  const jwt = createJwtHelper(JWT_SECRET);
  const config: AuthRoutesConfig = {
    membershipQuery: "tenant:query:memberships",
    mfaVerifyHandler: MFA_VERIFY_QN,
    mfaVerifyRateLimit: null,
    ...overrides,
  };
  const app = new HonoCtor();
  const jwtGuard = authMiddleware(jwt);
  app.use("/api/*", async (c, next) => {
    if (PUBLIC_API_PATHS.has(c.req.path)) return next();
    return jwtGuard(c, next);
  });
  app.route("/api", createAuthRoutes(dispatcher, jwt, config));
  return { app };
}

function verifyRequest(body: unknown): Request {
  return new Request("http://localhost/api/auth/mfa/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /auth/mfa/verify", () => {
  test("is public — reachable without a JWT", async () => {
    expect(PUBLIC_API_PATHS.has("/api/auth/mfa/verify")).toBe(true);
  });

  test("not mounted when mfaVerifyHandler is unset", async () => {
    const { app } = await buildApp({ mfaVerifyHandler: undefined });
    const res = await app.request(verifyRequest({ challengeToken: "t", code: "123456" }));
    expect(res.status).toBe(404);
  });

  test("400 on a malformed body, before dispatch or rate-limit", async () => {
    let dispatched = false;
    const dispatcher = createStubDispatcher({
      async write(): Promise<WriteResult> {
        dispatched = true;
        return { isSuccess: true, data: { kind: "mfa-verify-success", session: TestUsers.user } };
      },
    });
    const { app } = await buildApp({}, dispatcher);
    const res = await app.request(verifyRequest({ challengeToken: "t" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { isSuccess: boolean; error: string };
    expect(body.error).toBe("invalid_body");
    expect(dispatched).toBe(false);
  });

  test("on success: dispatches to mfaVerifyHandler, mints a JWT + cookies", async () => {
    let receivedBody: unknown;
    const dispatcher = createStubDispatcher({
      async write(qn, payload): Promise<WriteResult> {
        expect(qn).toBe(MFA_VERIFY_QN);
        receivedBody = payload;
        return { isSuccess: true, data: { kind: "mfa-verify-success", session: TestUsers.user } };
      },
    });
    const { app } = await buildApp({}, dispatcher);
    const res = await app.request(
      verifyRequest({ challengeToken: "opaque-challenge-token", code: "123456" }),
    );
    expect(res.status).toBe(200);
    expect(receivedBody).toEqual({
      challengeToken: "opaque-challenge-token",
      code: "123456",
    });

    const body = (await res.json()) as { isSuccess: boolean; token: string };
    expect(body.isSuccess).toBe(true);
    expect(typeof body.token).toBe("string");
    expect(body.token.length).toBeGreaterThan(20);

    const cookies = getSetCookies(res);
    expect(cookies.get(AUTH_COOKIE_NAME)).toBeDefined();
    expect(cookies.get(CSRF_COOKIE_NAME)).toBeDefined();
  });

  test("a handler failure maps through mfaVerifyErrorStatusMap", async () => {
    const dispatcher = createStubDispatcher({
      async write(): Promise<WriteResult> {
        return {
          isSuccess: false,
          error: new UnprocessableError("invalid_totp_code", {
            details: { reason: "invalid_totp_code" },
          }),
        };
      },
    });
    const { app } = await buildApp(
      { mfaVerifyErrorStatusMap: { invalid_totp_code: 422 } },
      dispatcher,
    );
    const res = await app.request(verifyRequest({ challengeToken: "t", code: "000000" }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { isSuccess: boolean };
    expect(body.isSuccess).toBe(false);
  });

  test("an unmapped handler failure falls back to the error's own httpStatus", async () => {
    const dispatcher = createStubDispatcher({
      async write(): Promise<WriteResult> {
        return { isSuccess: false, error: new InternalError({ message: "boom" }) };
      },
    });
    const { app } = await buildApp({}, dispatcher);
    const res = await app.request(verifyRequest({ challengeToken: "t", code: "000000" }));
    expect(res.status).toBe(500);
  });

  test("mfaVerifyRateLimit is independent from loginRateLimit — 429 after its own cap", async () => {
    // A failing dispatcher — reset() only fires on success, so failed
    // attempts accumulate against the cap instead of clearing it each time.
    const dispatcher = createStubDispatcher({
      async write(): Promise<WriteResult> {
        return {
          isSuccess: false,
          error: new UnprocessableError("invalid_totp_code"),
        };
      },
    });
    const { app } = await buildApp(
      { mfaVerifyRateLimit: createInMemoryLoginRateLimiter(2, 60_000) },
      dispatcher,
    );
    const attempt = () => app.request(verifyRequest({ challengeToken: "t", code: "000000" }));
    expect((await attempt()).status).toBe(422);
    expect((await attempt()).status).toBe(422);
    const third = await attempt();
    expect(third.status).toBe(429);
    const body = (await third.json()) as { isSuccess: boolean; error: string };
    expect(body.error).toBe("rate_limited");
  });

  test("a successful verify resets the rate-limit counter for that IP", async () => {
    const { app } = await buildApp({
      mfaVerifyRateLimit: createInMemoryLoginRateLimiter(1, 60_000),
    });
    const attempt = () => app.request(verifyRequest({ challengeToken: "t", code: "000000" }));
    expect((await attempt()).status).toBe(200);
    // Without a reset-on-success this would be 429 (cap=1 already spent).
    expect((await attempt()).status).toBe(200);
  });
});
