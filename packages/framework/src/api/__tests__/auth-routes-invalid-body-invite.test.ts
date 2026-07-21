// auth-routes invalid_body + invite-accept success paths — HTTP-layer only,
// stub Dispatcher (same pattern as auth-routes-mfa-verify.test.ts).

import { describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { Hono as HonoCtor } from "hono";
import type { SessionUser, TenantId } from "../../engine/types";
import type { BatchResult, Dispatcher, WriteResult } from "../../pipeline/dispatcher";
import { TestUsers } from "../../stack";
import { getSetCookies } from "../../testing/http-cookies";
import { PUBLIC_API_PATHS } from "../api-constants";
import { AUTH_COOKIE_NAME, authMiddleware, CSRF_COOKIE_NAME } from "../auth-middleware";
import { type AuthRoutesConfig, createAuthRoutes } from "../auth-routes";
import { createJwtHelper } from "../jwt";

const JWT_SECRET = "auth-routes-invalid-body-invite-secret-min-32-chars";
const INVITE_ACCEPT_QN = "auth:write:invite-accept";
const INVITE_LOGIN_QN = "auth:write:invite-accept-with-login";

function createStubDispatcher(overrides?: Partial<Dispatcher>): Dispatcher {
  const base: Dispatcher = {
    async write(): Promise<WriteResult> {
      const ok: WriteResult = { isSuccess: true, data: { kind: "noop" } };
      return ok;
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
  };
  return { ...base, ...overrides };
}

async function buildApp(
  overrides: Partial<AuthRoutesConfig> = {},
  dispatcher: Dispatcher = createStubDispatcher(),
): Promise<{ app: Hono; validToken: string }> {
  const jwt = createJwtHelper(JWT_SECRET);
  const validToken = await jwt.sign(TestUsers.user);
  const config: AuthRoutesConfig = {
    membershipQuery: "tenant:query:memberships",
    loginHandler: "auth:write:login",
    loginRateLimit: null,
    ...overrides,
  };
  const app = new HonoCtor();
  const jwtGuard = authMiddleware(jwt);
  app.use("/api/*", async (c, next) => {
    if (PUBLIC_API_PATHS.has(c.req.path)) return next();
    return jwtGuard(c, next);
  });
  app.route("/api", createAuthRoutes(dispatcher, jwt, config));
  return { app, validToken };
}

const inviteConfig: AuthRoutesConfig["invite"] = {
  acceptHandler: INVITE_ACCEPT_QN,
  acceptWithLoginHandler: INVITE_LOGIN_QN,
  signupCompleteHandler: "auth:write:invite-signup-complete",
};

describe("POST /auth/login — invalid_body", () => {
  test("400 when password field is missing", async () => {
    let dispatched = false;
    const dispatcher = createStubDispatcher({
      async write(): Promise<WriteResult> {
        dispatched = true;
        return { isSuccess: true, data: { kind: "auth-session", session: TestUsers.user } };
      },
    });
    const { app } = await buildApp({}, dispatcher);
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.c" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { isSuccess: boolean; error: string };
    expect(body.error).toBe("invalid_body");
    expect(dispatched).toBe(false);
  });
});

describe("POST /auth/invite-accept", () => {
  test("requires JWT — not a public route", async () => {
    expect(PUBLIC_API_PATHS.has("/api/auth/invite-accept")).toBe(false);
  });

  test("400 invalid_body before dispatch", async () => {
    let dispatched = false;
    const dispatcher = createStubDispatcher({
      async write(): Promise<WriteResult> {
        dispatched = true;
        return {
          isSuccess: true,
          data: {
            kind: "invite-accepted",
            tenantId: TestUsers.otherTenant.tenantId,
            role: "User",
            alreadyMember: false,
          },
        };
      },
    });
    const { app, validToken } = await buildApp({ invite: inviteConfig }, dispatcher);
    const res = await app.request("/api/auth/invite-accept", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${validToken}`,
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { isSuccess: boolean; error: string }).toMatchObject({
      isSuccess: false,
      error: "invalid_body",
    });
    expect(dispatched).toBe(false);
  });

  test("success returns tenantId, role, alreadyMember", async () => {
    const tenantId = TestUsers.otherTenant.tenantId as TenantId;
    let receivedUser: SessionUser | undefined;
    const dispatcher = createStubDispatcher({
      async write(qn, payload, user): Promise<WriteResult> {
        expect(qn).toBe(INVITE_ACCEPT_QN);
        expect(payload).toEqual({ token: "invite-token-abc" });
        receivedUser = user;
        return {
          isSuccess: true,
          data: {
            kind: "invite-accepted",
            tenantId,
            role: "Editor",
            alreadyMember: true,
          },
        };
      },
    });
    const { app, validToken } = await buildApp({ invite: inviteConfig }, dispatcher);
    const res = await app.request("/api/auth/invite-accept", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${validToken}`,
      },
      body: JSON.stringify({ token: "invite-token-abc" }),
    });
    expect(res.status).toBe(200);
    expect(receivedUser?.id).toBe(TestUsers.user.id);
    expect(await res.json()).toEqual({
      isSuccess: true,
      tenantId,
      role: "Editor",
      alreadyMember: true,
    });
  });
});

describe("POST /auth/invite-accept-with-login — invalid_body + success", () => {
  test("400 when email missing", async () => {
    let dispatched = false;
    const dispatcher = createStubDispatcher({
      async write(): Promise<WriteResult> {
        dispatched = true;
        return { isSuccess: true, data: { kind: "auth-session", session: TestUsers.user } };
      },
    });
    const { app } = await buildApp({ invite: inviteConfig }, dispatcher);
    const res = await app.request("/api/auth/invite-accept-with-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "t", password: "long-enough-pw" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({
      isSuccess: false,
      error: "invalid_body",
    });
    expect(dispatched).toBe(false);
  });

  test("success mints JWT + cookies", async () => {
    const tenantId = TestUsers.otherTenant.tenantId as TenantId;
    const dispatcher = createStubDispatcher({
      async write(qn, payload): Promise<WriteResult> {
        expect(qn).toBe(INVITE_LOGIN_QN);
        expect(payload).toEqual({
          token: "invite-t",
          email: "user@example.com",
          password: "password123",
        });
        return {
          isSuccess: true,
          data: {
            kind: "auth-session",
            session: TestUsers.user,
            tenantId,
            role: "User",
          },
        };
      },
    });
    const { app } = await buildApp({ invite: inviteConfig }, dispatcher);
    const res = await app.request("/api/auth/invite-accept-with-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: "invite-t",
        email: "user@example.com",
        password: "password123",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      isSuccess: boolean;
      token: string;
      tenantId: TenantId;
      role: string;
    };
    expect(body.isSuccess).toBe(true);
    expect(typeof body.token).toBe("string");
    expect(body.tenantId).toBe(tenantId);
    expect(body.role).toBe("User");
    expect(getSetCookies(res).get(AUTH_COOKIE_NAME)).toBeDefined();
    expect(getSetCookies(res).get(CSRF_COOKIE_NAME)).toBeDefined();
  });
});
