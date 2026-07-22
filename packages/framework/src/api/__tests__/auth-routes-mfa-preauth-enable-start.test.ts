// auth-routes /auth/mfa/preauth-enable-start — framework-level route
// mechanics only: body validation, dispatch-without-minting-a-session, and
// error-status mapping. Uses a stub Dispatcher with a fake handler — the
// REAL preauthSetupToken verification / secret generation lives in
// auth-mfa's own handler and is covered there, not here.

import { describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { Hono as HonoCtor } from "hono";
import { InternalError, UnprocessableError } from "../../errors";
import type { BatchResult, Dispatcher, WriteResult } from "../../pipeline/dispatcher";
import { PUBLIC_API_PATHS } from "../api-constants";
import { authMiddleware } from "../auth-middleware";
import { type AuthRoutesConfig, createAuthRoutes } from "../auth-routes";
import { createJwtHelper } from "../jwt";

const JWT_SECRET = "test-jwt-secret-at-least-32-bytes-long!!";
const PREAUTH_ENABLE_START_QN = "auth-mfa:write:enable-start-preauth";

function createStubDispatcher(overrides?: Partial<Dispatcher>): Dispatcher {
  const base: Dispatcher = {
    async write(): Promise<WriteResult> {
      const ok: WriteResult = {
        isSuccess: true,
        data: {
          setupToken: "stub-setup-token",
          otpauthUri: "otpauth://totp/stub",
          recoveryCodes: ["AAAA-BBBB"],
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
    mfaPreauthEnableStartHandler: PREAUTH_ENABLE_START_QN,
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

function preauthStartRequest(body: unknown): Request {
  return new Request("http://localhost/api/auth/mfa/preauth-enable-start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /auth/mfa/preauth-enable-start", () => {
  test("is public — reachable without a JWT", async () => {
    expect(PUBLIC_API_PATHS.has("/api/auth/mfa/preauth-enable-start")).toBe(true);
  });

  test("not mounted when mfaPreauthEnableStartHandler is unset", async () => {
    const { app } = await buildApp({ mfaPreauthEnableStartHandler: undefined });
    const res = await app.request(
      preauthStartRequest({ preauthSetupToken: "t", accountLabel: "a@b.c" }),
    );
    expect(res.status).toBe(404);
  });

  test("400 on a malformed body, before dispatch", async () => {
    let dispatched = false;
    const dispatcher = createStubDispatcher({
      async write(): Promise<WriteResult> {
        dispatched = true;
        return {
          isSuccess: true,
          data: { setupToken: "x", otpauthUri: "otpauth://totp/x", recoveryCodes: [] },
        };
      },
    });
    const { app } = await buildApp({}, dispatcher);
    const res = await app.request(preauthStartRequest({ preauthSetupToken: "t" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { isSuccess: boolean; error: string };
    expect(body.error).toBe("invalid_body");
    expect(dispatched).toBe(false);
  });

  test("on success: dispatches to the handler, returns setupToken/otpauthUri/recoveryCodes, mints NO session", async () => {
    let receivedBody: unknown;
    const dispatcher = createStubDispatcher({
      async write(qn, payload): Promise<WriteResult> {
        expect(qn).toBe(PREAUTH_ENABLE_START_QN);
        receivedBody = payload;
        return {
          isSuccess: true,
          data: {
            setupToken: "secret-carrying-setup-token",
            otpauthUri: "otpauth://totp/Kumiko:a%40b.c",
            recoveryCodes: ["AAAA-BBBB", "CCCC-DDDD"],
          },
        };
      },
    });
    const { app } = await buildApp({}, dispatcher);
    const res = await app.request(
      preauthStartRequest({ preauthSetupToken: "opaque-preauth-token", accountLabel: "a@b.c" }),
    );
    expect(res.status).toBe(200);
    expect(receivedBody).toEqual({
      preauthSetupToken: "opaque-preauth-token",
      accountLabel: "a@b.c",
    });

    const body = (await res.json()) as {
      isSuccess: boolean;
      setupToken: string;
      otpauthUri: string;
      recoveryCodes: string[];
      token?: string;
    };
    expect(body.isSuccess).toBe(true);
    expect(body.setupToken).toBe("secret-carrying-setup-token");
    expect(body.otpauthUri).toBe("otpauth://totp/Kumiko:a%40b.c");
    expect(body.recoveryCodes).toEqual(["AAAA-BBBB", "CCCC-DDDD"]);
    // No JWT minted — unlike /auth/login and /auth/mfa/verify, this route
    // never establishes a session.
    expect(body.token).toBeUndefined();
  });

  test("a handler failure maps through mfaPreauthEnableStartErrorStatusMap", async () => {
    const dispatcher = createStubDispatcher({
      async write(): Promise<WriteResult> {
        return {
          isSuccess: false,
          error: new UnprocessableError("invalid_challenge_token", {
            details: { reason: "invalid_challenge_token" },
          }),
        };
      },
    });
    const { app } = await buildApp(
      { mfaPreauthEnableStartErrorStatusMap: { invalid_challenge_token: 422 } },
      dispatcher,
    );
    const res = await app.request(
      preauthStartRequest({ preauthSetupToken: "t", accountLabel: "a@b.c" }),
    );
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
    const res = await app.request(
      preauthStartRequest({ preauthSetupToken: "t", accountLabel: "a@b.c" }),
    );
    expect(res.status).toBe(500);
  });
});
