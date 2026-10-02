// registerTokenRequestRoute: handler failures are logged, except the
// attacker-triggerable rate_limited case. HTTP-layer only, stub dispatcher.

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Hono } from "hono";
import type { BatchResult, Dispatcher, WriteResult } from "../../pipeline/dispatcher.js";
import { createAuthRoutes } from "../auth-routes.js";
import { createJwtHelper } from "../jwt.js";

const JWT_SECRET = "token-request-logging-test-secret-0123456789";
const REQUEST_HANDLER = "auth:write:request-password-reset";

function dispatcherFailingWith(code: string): Dispatcher {
  return {
    async write(): Promise<WriteResult> {
      return { isSuccess: false, error: { code, message: code } } as WriteResult; // @cast-boundary stub failure shape
    },
    async query(): Promise<unknown> {
      return [];
    },
    async command(): Promise<void> {},
    async batch(): Promise<BatchResult> {
      return { isSuccess: true, results: [] };
    },
    async resolveAuthClaims(): Promise<Record<string, unknown>> {
      return {};
    },
    async resolveActiveMembership() {
      return { kind: "rejected", reason: "not_a_member" };
    },
    async *stream(): AsyncGenerator<unknown> {},
    createMemberReader() {
      return async () => {
        throw new Error("not available in this stub");
      };
    },
  };
}

function buildApp(dispatcher: Dispatcher): Hono {
  const app = new Hono();
  app.route(
    "/api",
    createAuthRoutes(dispatcher, createJwtHelper(JWT_SECRET), {
      membershipQuery: "tenant:query:memberships",
      loginHandler: "auth:write:login",
      loginRateLimit: null,
      passwordReset: {
        requestHandler: REQUEST_HANDLER,
        confirmHandler: "auth:write:reset-password",
      },
    }),
  );
  return app;
}

async function requestReset(app: Hono): Promise<Response> {
  return app.request("/api/auth/request-password-reset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "someone@example.com" }),
  });
}

describe("POST /auth/request-password-reset failure logging", () => {
  let errorSpy: ReturnType<typeof spyOn>;
  beforeEach(() => {
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockRestore());

  test("rate_limited stays silent and the response is still uniform success", async () => {
    const res = await requestReset(buildApp(dispatcherFailingWith("rate_limited")));
    expect(res.status).toBe(200);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test("an unexpected failure code is logged", async () => {
    const res = await requestReset(buildApp(dispatcherFailingWith("internal_error")));
    expect(res.status).toBe(200);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain("internal_error");
  });
});
