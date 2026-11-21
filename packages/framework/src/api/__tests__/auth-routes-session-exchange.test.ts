// POST /auth/session-exchange — app-defined login handlers minted into a session by the framework.
// Stub Dispatcher: only the HTTP layer (mapping, gating, cookies) is under test.

import { describe, expect, test } from "bun:test";
import { getSetCookies } from "@cosmicdrift/kumiko-testing/helpers";
import type { Hono } from "hono";
import { Hono as HonoCtor } from "hono";
import { UnprocessableError, writeFailure } from "../../errors/index.ts";
import type { BatchResult, Dispatcher, WriteResult } from "../../pipeline/dispatcher.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import { PUBLIC_API_PATHS } from "../api-constants.ts";
import { type AuthRoutesConfig, createAuthRoutes } from "../auth-routes.ts";
import type { LoginRateLimiter } from "../auth-routes-types.ts";
import { createJwtHelper } from "../jwt.ts";
import {
  AUTH_COOKIE_BASE,
  resolveSessionCookies,
  sessionCookiesMiddleware,
} from "../session-cookies.ts";

const JWT_SECRET = "[REDACTED:API key param]";
const APPLE_QN = "auth-apple:write:exchange";

type WriteCall = { qn: string; payload: unknown };

function createStubDispatcher(respond: () => WriteResult, calls: WriteCall[]): Dispatcher {
  const merged: Dispatcher = {
    async write(target: unknown, payload: unknown): Promise<WriteResult> {
      calls.push({ qn: String(target), payload });
      return respond();
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
    async resolveActiveMembership() {
      return { kind: "rejected", reason: "not_a_member" };
    },
    createMemberReader() {
      return async () => {
        throw new Error("createMemberReader not available in this stub");
      };
    },
  };
  return merged;
}

function sessionResult(): WriteResult {
  const ok: WriteResult = {
    isSuccess: true,
    data: { kind: "auth-session", session: TestUsers.user },
  };
  return ok;
}

function buildApp(
  respond: () => WriteResult,
  calls: WriteCall[],
  overrides: Partial<AuthRoutesConfig> = {},
): Hono {
  const jwt = createJwtHelper(JWT_SECRET);
  const config: AuthRoutesConfig = {
    membershipQuery: "tenant:query:memberships",
    loginRateLimit: null,
    sessionExchangeHandlers: { apple: APPLE_QN },
    ...overrides,
  };
  const app = new HonoCtor();
  app.use("*", sessionCookiesMiddleware(resolveSessionCookies({})));
  app.route("/api", createAuthRoutes(createStubDispatcher(respond, calls), jwt, config));
  return app;
}

function exchange(app: Hono, body: unknown): Promise<Response> | Response {
  return app.request("/api/auth/session-exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /auth/session-exchange", () => {
  test("known method mints a session: token in body, auth cookie set, handler got qn + payload", async () => {
    const calls: WriteCall[] = [];
    const app = buildApp(sessionResult, calls);
    const payload = { idToken: "abc" };
    const res = await exchange(app, { method: "apple", payload });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { isSuccess: boolean; token: string };
    expect(body.isSuccess).toBe(true);
    expect(body.token.length).toBeGreaterThan(20);
    expect(getSetCookies(res).get(AUTH_COOKIE_BASE)).toBeDefined();
    expect(calls).toEqual([{ qn: APPLE_QN, payload }]);
  });

  test("unknown method is 400 unknown_method and never reaches the dispatcher", async () => {
    const calls: WriteCall[] = [];
    const res = await exchange(buildApp(sessionResult, calls), { method: "google", payload: {} });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ isSuccess: false, error: "unknown_method" });
    expect(calls).toEqual([]);
  });

  test("prototype keys are not resolved as methods", async () => {
    const calls: WriteCall[] = [];
    const app = buildApp(sessionResult, calls);
    for (const method of ["__proto__", "toString", "constructor"]) {
      const res = await exchange(app, { method, payload: {} });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ isSuccess: false, error: "unknown_method" });
    }
    expect(calls).toEqual([]);
  });

  test("malformed body is 400 invalid_body", async () => {
    const calls: WriteCall[] = [];
    const res = await exchange(buildApp(sessionResult, calls), { method: 42 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ isSuccess: false, error: "invalid_body" });
  });

  test("handler error reason is mapped through loginErrorStatusMap", async () => {
    const failing = (): WriteResult => writeFailure(new UnprocessableError("invalid_credentials"));
    const app = buildApp(failing, [], { loginErrorStatusMap: { invalid_credentials: 401 } });
    const res = await exchange(app, { method: "apple", payload: {} });
    expect(res.status).toBe(401);
  });

  test("non-session handler results are 500 invalid_exchange_result without cookies", async () => {
    for (const data of [{ kind: "mfa-challenge", challengeToken: "x" }, "nope", null, {}]) {
      const respond = (): WriteResult => {
        const ok: WriteResult = { isSuccess: true, data };
        return ok;
      };
      const res = await exchange(buildApp(respond, []), { method: "apple", payload: {} });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ isSuccess: false, error: "invalid_exchange_result" });
      expect(res.headers.getSetCookie()).toEqual([]);
    }
  });

  function reservingLimiter(onRefund: (key: string, window: string) => Promise<void> | void) {
    const reserved: string[] = [];
    const checked: string[] = [];
    const resets: string[] = [];
    const limiter: LoginRateLimiter = {
      check: async (key) => {
        checked.push(key);
        return true;
      },
      reserve: async (key) => {
        reserved.push(key);
        return { allowed: true, window: "w-1" };
      },
      reset: async (key) => {
        resets.push(key);
      },
      refund: async (key, window) => onRefund(key, window),
    };
    return { limiter, reserved, checked, resets };
  }

  test("a successful exchange refunds its reservation once with its window and never resets", async () => {
    const refunds: Array<{ key: string; window: string }> = [];
    const { limiter, reserved, checked, resets } = reservingLimiter((key, window) => {
      refunds.push({ key, window });
    });
    const app = buildApp(sessionResult, [], { loginRateLimit: limiter });
    const res = await exchange(app, { method: "apple", payload: {} });
    expect(res.status).toBe(200);
    expect(reserved).toHaveLength(1);
    expect(checked).toEqual([]);
    expect(resets).toEqual([]);
    expect(refunds.map((refund) => refund.window)).toEqual(["w-1"]);
    expect(refunds.map((refund) => refund.key)).toEqual(reserved);
  });

  test("a failing refund leaves the exchange successful", async () => {
    const { limiter } = reservingLimiter(async () => {
      throw new Error("redis down");
    });
    const app = buildApp(sessionResult, [], { loginRateLimit: limiter });
    const res = await exchange(app, { method: "apple", payload: {} });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { isSuccess: boolean }).isSuccess).toBe(true);
  });

  test("a limiter with only check is counted and never refunded", async () => {
    const checks: string[] = [];
    const app = buildApp(sessionResult, [], {
      loginRateLimit: {
        check: async (key) => {
          checks.push(key);
          return true;
        },
        reset: async () => {},
      },
    });
    const res = await exchange(app, { method: "apple", payload: {} });
    expect(res.status).toBe(200);
    expect(checks).toHaveLength(1);
  });

  test("a rejected reservation is 429 and never reaches the dispatcher", async () => {
    const calls: WriteCall[] = [];
    const limiter: LoginRateLimiter = {
      check: async () => true,
      reserve: async () => ({ allowed: false, window: "w-1" }),
      refund: async () => {},
      reset: async () => {},
    };
    const res = await exchange(buildApp(sessionResult, calls, { loginRateLimit: limiter }), {
      method: "apple",
      payload: {},
    });
    expect(res.status).toBe(429);
    expect(calls).toEqual([]);
  });

  test("a failed exchange does not refund its reservation", async () => {
    const refunds: string[] = [];
    const failing = (): WriteResult => writeFailure(new UnprocessableError("invalid_credentials"));
    const { limiter } = reservingLimiter((key) => {
      refunds.push(key);
    });
    const app = buildApp(failing, [], { loginRateLimit: limiter });
    const res = await exchange(app, { method: "apple", payload: {} });
    expect(res.status).not.toBe(200);
    expect(refunds).toEqual([]);
  });

  test("route is not mounted without sessionExchangeHandlers", async () => {
    const app = buildApp(sessionResult, [], { sessionExchangeHandlers: undefined });
    const res = await exchange(app, { method: "apple", payload: {} });
    expect(res.status).toBe(404);
  });

  test("mfaVerifyHandler together with sessionExchangeHandlers refuses to build the routes", () => {
    expect(() =>
      buildApp(sessionResult, [], {
        mfaVerifyHandler: "auth-mfa:write:verify",
        switchTenantMfaGateHandler: "auth:write:switch-tenant-mfa-gate",
      }),
    ).toThrow("would mint sessions without the second factor");
  });

  test("path is public (bypasses the JWT guard)", () => {
    expect(PUBLIC_API_PATHS.has("/api/auth/session-exchange")).toBe(true);
  });

  describe("rate limit selection", () => {
    function stubLimiter(): { limiter: LoginRateLimiter; checks: string[] } {
      const checks: string[] = [];
      return {
        checks,
        limiter: {
          async check(key: string) {
            checks.push(key);
            return true;
          },
          async reset() {},
        },
      };
    }

    test("sessionExchangeRateLimit: null skips the check although loginRateLimit is set", async () => {
      const login = stubLimiter();
      const app = buildApp(sessionResult, [], {
        loginRateLimit: login.limiter,
        sessionExchangeRateLimit: null,
      });
      const res = await exchange(app, { method: "apple", payload: {} });
      expect(res.status).toBe(200);
      expect(login.checks).toEqual([]);
    });

    test("an own sessionExchangeRateLimit is asked instead of loginRateLimit", async () => {
      const login = stubLimiter();
      const own = stubLimiter();
      const app = buildApp(sessionResult, [], {
        loginRateLimit: login.limiter,
        sessionExchangeRateLimit: own.limiter,
      });
      const res = await exchange(app, { method: "apple", payload: {} });
      expect(res.status).toBe(200);
      expect(own.checks).toHaveLength(1);
      expect(own.checks[0]).toEndWith("|session-exchange:apple");
      expect(login.checks).toEqual([]);
    });

    test("without sessionExchangeRateLimit the login limiter is used", async () => {
      const login = stubLimiter();
      const app = buildApp(sessionResult, [], { loginRateLimit: login.limiter });
      await exchange(app, { method: "apple", payload: {} });
      expect(login.checks).toHaveLength(1);
    });
  });
});
