// auth-routes /auth/mfa/preauth-confirm — framework-level route mechanics
// only: body validation, dispatch-and-mint-on-success, its OWN rate limiter
// (mfaPreauthConfirmRateLimit, distinct from mfaVerifyRateLimit/
// loginRateLimit), and error-status mapping. Uses a stub Dispatcher with a
// fake handler — the REAL setupToken verification / TOTP check / brute-
// force cap lives in auth-mfa's own handler and is covered there, not here.

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

const JWT_SECRET = "test-jwt-secret-for-mfa-preauth-confirm-route-tests-only-not-a-real-secret";
const PREAUTH_CONFIRM_QN = "auth-mfa:write:enable-confirm-preauth";

function createStubDispatcher(overrides?: Partial<Dispatcher>): Dispatcher {
  const base: Dispatcher = {
    async write(): Promise<WriteResult> {
      const ok: WriteResult = {
        isSuccess: true,
        data: { kind: "mfa-preauth-confirm-success", session: TestUsers.user },
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
    mfaPreauthConfirmHandler: PREAUTH_CONFIRM_QN,
    mfaPreauthConfirmRateLimit: null,
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

function preauthConfirmRequest(body: unknown): Request {
  return new Request("http://localhost/api/auth/mfa/preauth-confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /auth/mfa/preauth-confirm", () => {
  test("is public — reachable without a JWT", async () => {
    expect(PUBLIC_API_PATHS.has("/api/auth/mfa/preauth-confirm")).toBe(true);
  });

  test("not mounted when mfaPreauthConfirmHandler is unset", async () => {
    const { app } = await buildApp({ mfaPreauthConfirmHandler: undefined });
    const res = await app.request(preauthConfirmRequest({ setupToken: "t", code: "123456" }));
    expect(res.status).toBe(404);
  });

  test("400 on a malformed body, before dispatch or rate-limit", async () => {
    let dispatched = false;
    const dispatcher = createStubDispatcher({
      async write(): Promise<WriteResult> {
        dispatched = true;
        return {
          isSuccess: true,
          data: { kind: "mfa-preauth-confirm-success", session: TestUsers.user },
        };
      },
    });
    const { app } = await buildApp({}, dispatcher);
    const res = await app.request(preauthConfirmRequest({ setupToken: "t" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { isSuccess: boolean; error: string };
    expect(body.error).toBe("invalid_body");
    expect(dispatched).toBe(false);
  });

  test("on success: dispatches to mfaPreauthConfirmHandler, mints a JWT + cookies", async () => {
    let receivedBody: unknown;
    const dispatcher = createStubDispatcher({
      async write(qn, payload): Promise<WriteResult> {
        expect(qn).toBe(PREAUTH_CONFIRM_QN);
        receivedBody = payload;
        return {
          isSuccess: true,
          data: { kind: "mfa-preauth-confirm-success", session: TestUsers.user },
        };
      },
    });
    const { app } = await buildApp({}, dispatcher);
    const res = await app.request(
      preauthConfirmRequest({ setupToken: "secret-carrying-setup-token", code: "123456" }),
    );
    expect(res.status).toBe(200);
    expect(receivedBody).toEqual({
      setupToken: "secret-carrying-setup-token",
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

  test("a handler failure maps through mfaPreauthConfirmErrorStatusMap", async () => {
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
      { mfaPreauthConfirmErrorStatusMap: { invalid_totp_code: 422 } },
      dispatcher,
    );
    const res = await app.request(preauthConfirmRequest({ setupToken: "t", code: "000000" }));
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
    const res = await app.request(preauthConfirmRequest({ setupToken: "t", code: "000000" }));
    expect(res.status).toBe(500);
  });

  test("mfaPreauthConfirmRateLimit is independent from mfaVerifyRateLimit — 429 after its own cap", async () => {
    const dispatcher = createStubDispatcher({
      async write(): Promise<WriteResult> {
        return {
          isSuccess: false,
          error: new UnprocessableError("invalid_totp_code"),
        };
      },
    });
    const { app } = await buildApp(
      { mfaPreauthConfirmRateLimit: createInMemoryLoginRateLimiter(2, 60_000) },
      dispatcher,
    );
    const attempt = () => app.request(preauthConfirmRequest({ setupToken: "t", code: "000000" }));
    expect((await attempt()).status).toBe(422);
    expect((await attempt()).status).toBe(422);
    const third = await attempt();
    expect(third.status).toBe(429);
    const body = (await third.json()) as { isSuccess: boolean; error: string };
    expect(body.error).toBe("rate_limited");
  });

  test("a successful confirm resets the rate-limit counter for that IP", async () => {
    const { app } = await buildApp({
      mfaPreauthConfirmRateLimit: createInMemoryLoginRateLimiter(1, 60_000),
    });
    const attempt = () => app.request(preauthConfirmRequest({ setupToken: "t", code: "000000" }));
    expect((await attempt()).status).toBe(200);
    expect((await attempt()).status).toBe(200);
  });
});
