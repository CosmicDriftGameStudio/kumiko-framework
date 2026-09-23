// Full-stack proof for the declarative extraRoutes API (kumiko-framework#3050):
// each `entry` tier gets the matching guard + deps from buildServer, driven
// via real HTTP (setupTestStack + app.request), never createTestDispatcher.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { z } from "zod";
import { createRegistry, defineFeature, type TenantId } from "../../engine";
import { RateLimitError } from "../../errors";
import { setupTestStack, type TestStack, TestUsers } from "../../stack";
import {
  type AnonymousExtraRoute,
  type ExtraRouteDefinition,
  ExtraRouteRejection,
  type SignatureExtraRoute,
  signatureRoute,
  type UserExtraRoute,
} from "../extra-route";
import { buildServer } from "../server";

const TENANT_ID = "00000000-0000-4000-8000-000000000001" as TenantId;
const JWT_SECRET = "test-extra-routes-secret-32-chars-min!!";

const probeFeature = defineFeature("extra-route-probe", (r) => {
  r.queryHandler({
    name: "ping",
    schema: z.object({}),
    access: { roles: ["anonymous"] },
    rateLimit: { per: "ip", limit: 2, windowSeconds: 60 },
    handler: async () => ({ pong: true }),
  });
  r.writeHandler({
    name: "self-write",
    schema: z.object({ note: z.string() }),
    access: { roles: ["User", "Admin"] },
    handler: async (event) => ({
      isSuccess: true as const,
      data: { userId: event.user.id, note: event.payload.note },
    }),
  });
  r.writeHandler({
    name: "admin-only-write",
    schema: z.object({}),
    access: { roles: ["Admin"] },
    handler: async () => ({ isSuccess: true as const, data: { ok: true as const } }),
  });
  r.writeHandler({
    name: "hmac-write",
    schema: z.object({ note: z.string() }),
    access: { roles: ["SystemAdmin"] },
    handler: async (event) => ({
      isSuccess: true as const,
      data: { tenantSeen: event.user.tenantId, note: event.payload.note },
    }),
  });
});

describe("extraRoutes: entry:anonymous", () => {
  const pingRoute: AnonymousExtraRoute = {
    method: "GET",
    path: "/public/ping",
    entry: "anonymous",
    handler: async (c, deps) => {
      try {
        const result = await deps.systemQuery("extra-route-probe:query:ping", {}, TENANT_ID);
        return c.json(result as { pong: boolean }); // @cast-boundary engine-payload
      } catch (e) {
        if (e instanceof RateLimitError) {
          return c.json({ error: { code: e.code } }, e.httpStatus);
        }
        throw e;
      }
    },
  };

  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({ features: [probeFeature], extraRoutes: [pingRoute] });
  });

  afterAll(() => stack.cleanup());

  test("reachable without any session, outside /api", async () => {
    const res = await stack.app.request("/public/ping", {
      headers: { "x-forwarded-for": "203.0.113.10" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pong: true });
  });

  test("systemQuery wraps requestContext so a handler's per-ip rateLimit actually fires", async () => {
    const ip = "203.0.113.20";
    for (let i = 0; i < 2; i++) {
      const res = await stack.app.request("/public/ping", { headers: { "x-forwarded-for": ip } });
      expect(res.status).toBe(200);
    }
    const limited = await stack.app.request("/public/ping", { headers: { "x-forwarded-for": ip } });
    expect(limited.status).toBe(429);
    const body = (await limited.json()) as { error: { code: string } };
    expect(body.error.code).toBe("rate_limited");
  });
});

describe("extraRoutes: entry:anonymous under /api/* (kumiko-framework#3050 bypass fix)", () => {
  const apiPingRoute: AnonymousExtraRoute = {
    method: "GET",
    path: "/api/public-ping",
    entry: "anonymous",
    handler: async (c) => c.json({ pong: true }),
  };

  test("without anonymousAccess wired, the jwtGuard still 401s — anonymous does NOT bypass /api/*", async () => {
    const stack = await setupTestStack({ features: [probeFeature], extraRoutes: [apiPingRoute] });
    try {
      const res = await stack.app.request("/api/public-ping");
      expect(res.status).toBe(401);
    } finally {
      await stack.cleanup();
    }
  });

  test("with anonymousAccess wired, the request clears the guard exactly like any other anonymous /api/* call", async () => {
    const stack = await setupTestStack({
      features: [probeFeature],
      extraRoutes: [apiPingRoute],
      anonymousAccess: { defaultTenantId: TENANT_ID },
    });
    try {
      const res = await stack.app.request("/api/public-ping");
      expect(res.status).toBe(200);
    } finally {
      await stack.cleanup();
    }
  });
});

describe("extraRoutes: entry:user", () => {
  const selfWriteRoute: UserExtraRoute = {
    method: "POST",
    path: "/api/user-probe",
    entry: "user",
    handler: async (c, deps) => {
      const result = await deps.write("extra-route-probe:write:self-write", { note: "hi" });
      return c.json({ userId: deps.user.id, result });
    },
  };
  const adminOnlyRoute: UserExtraRoute = {
    method: "POST",
    path: "/api/user-admin-probe",
    entry: "user",
    handler: async (c, deps) => {
      const result = await deps.write("extra-route-probe:write:admin-only-write", {});
      return c.json(result);
    },
  };

  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({
      features: [probeFeature],
      extraRoutes: [selfWriteRoute, adminOnlyRoute],
    });
  });

  afterAll(() => stack.cleanup());

  test("without a session → 401 (jwtGuard rejects before the route ever runs)", async () => {
    const res = await stack.app.request("/api/user-probe", { method: "POST" });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("missing_token");
  });

  test("with a real session → 200, deps.user.id matches the JWT subject", async () => {
    const token = await stack.jwt.sign(TestUsers.user);
    const res = await stack.app.request("/api/user-probe", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId: string; result: { isSuccess: boolean } };
    expect(body.userId).toBe(TestUsers.user.id);
    expect(body.result.isSuccess).toBe(true);
  });

  test("deps.write runs access-checked as the calling user — 'User' role denied on an Admin-only handler", async () => {
    const token = await stack.jwt.sign(TestUsers.user);
    const res = await stack.app.request("/api/user-admin-probe", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { isSuccess: boolean; error?: { code: string } };
    expect(body.isSuccess).toBe(false);
    expect(body.error?.code).toBe("access_denied");
  });

  test("deps.write succeeds for a user whose role clears the handler's access check", async () => {
    const token = await stack.jwt.sign(TestUsers.admin);
    const res = await stack.app.request("/api/user-admin-probe", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { isSuccess: boolean };
    expect(body.isSuccess).toBe(true);
  });
});

describe("extraRoutes: entry:user under an anonymousAccess-wired server", () => {
  const selfWriteRoute: UserExtraRoute = {
    method: "POST",
    path: "/api/user-probe",
    entry: "user",
    handler: async (c, deps) => c.json({ userId: deps.user.id }),
  };

  test("no JWT: jwtGuard synthesises an anonymous user, buildExtraRouteHonoHandler's own ANONYMOUS_ROLE check still 401s", async () => {
    const stack = await setupTestStack({
      features: [probeFeature],
      extraRoutes: [selfWriteRoute],
      anonymousAccess: { defaultTenantId: TENANT_ID },
    });
    try {
      const res = await stack.app.request("/api/user-probe", { method: "POST" });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("unauthenticated");
    } finally {
      await stack.cleanup();
    }
  });
});

test("extraRoutes: entry:user route mounted outside /api throws at boot", () => {
  const registry = createRegistry([probeFeature]);
  expect(() =>
    buildServer({
      registry,
      context: {},
      jwtSecret: JWT_SECRET,
      extraRoutes: [
        {
          method: "GET",
          path: "/user-outside-api",
          entry: "user",
          handler: async (c) => c.json({}),
        },
      ],
    }),
  ).toThrow(/must be\s+mounted under "\/api\/"/);
});

test("extraRoutes: entry:signature wildcard under /api throws at boot", () => {
  const registry = createRegistry([probeFeature]);
  expect(() =>
    buildServer({
      registry,
      context: {},
      jwtSecret: JWT_SECRET,
      extraRoutes: [
        signatureRoute({
          method: "POST",
          path: "/api/*",
          entry: "signature",
          verify: async () => true,
          handler: async (c) => c.json({}),
        }),
      ],
    }),
  ).toThrow(/must not\s+use a wildcard under "\/api\/"/);
});

test("extraRoutes: an unknown entry value throws at boot", () => {
  const registry = createRegistry([probeFeature]);
  // A JS caller without the ExtraRouteDefinition type can construct this at
  // runtime — buildServer must reject it at boot, not at first request.
  const badRoute = {
    method: "GET",
    path: "/whatever",
    entry: "admin",
    handler: async () => new Response(),
  } as unknown as ExtraRouteDefinition; // @cast-boundary simulates an untyped JS caller passing an unknown entry
  expect(() =>
    buildServer({
      registry,
      context: {},
      jwtSecret: JWT_SECRET,
      extraRoutes: [badRoute],
    }),
  ).toThrow(/unknown entry/);
});

describe("extraRoutes: entry:signature", () => {
  const HMAC_KEY = "shared-hmac-key";

  function signHmac(rawBody: string): string {
    return createHmac("sha256", HMAC_KEY).update(rawBody).digest("hex");
  }

  const webhookRoute: SignatureExtraRoute<{ note: string }> = {
    method: "POST",
    path: "/webhooks/probe",
    entry: "signature",
    verify: async (req) => {
      if (req.headers["x-force-404"] === "1") {
        throw new ExtraRouteRejection(404, { error: "unknown-provider" });
      }
      if (req.headers["x-hmac"] !== signHmac(req.rawBody)) {
        throw new Error("signature mismatch");
      }
      return { note: (JSON.parse(req.rawBody) as { note: string }).note };
    },
    handler: async (c, verified, deps) => {
      const result = await deps.dispatchSystemWrite({
        handlerQn: "extra-route-probe:write:hmac-write",
        payload: { note: verified.note },
        tenantId: TENANT_ID,
      });
      return c.json(result);
    },
  };

  const webhookParamRoute: SignatureExtraRoute<{ provider: string }> = {
    method: "POST",
    path: "/api/webhooks/:provider",
    entry: "signature",
    verify: async (req) => {
      if (req.headers["x-hmac"] !== signHmac(req.rawBody)) throw new Error("signature mismatch");
      return { provider: req.params["provider"] ?? "" };
    },
    handler: async (c, verified) => c.json({ provider: verified.provider }),
  };

  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({
      features: [probeFeature],
      extraRoutes: [signatureRoute(webhookRoute), signatureRoute(webhookParamRoute)],
    });
  });

  afterAll(() => stack.cleanup());

  test("wrong signature → 401 extra_route_signature_invalid", async () => {
    const res = await stack.app.request("/webhooks/probe", {
      method: "POST",
      headers: { "x-hmac": "wrong", "content-type": "application/json" },
      body: JSON.stringify({ note: "x" }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("extra_route_signature_invalid");
  });

  test("right signature → 200, dispatchSystemWrite's SystemAdmin write is visible in the response", async () => {
    const rawBody = JSON.stringify({ note: "from-webhook" });
    const res = await stack.app.request("/webhooks/probe", {
      method: "POST",
      headers: { "x-hmac": signHmac(rawBody), "content-type": "application/json" },
      body: rawBody,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      isSuccess: boolean;
      data?: { tenantSeen: string; note: string };
    };
    expect(body.isSuccess).toBe(true);
    expect(body.data?.tenantSeen).toBe(TENANT_ID);
    expect(body.data?.note).toBe("from-webhook");
  });

  test("verify() throwing ExtraRouteRejection(404, body) surfaces exactly that body", async () => {
    const res = await stack.app.request("/webhooks/probe", {
      method: "POST",
      headers: { "x-force-404": "1", "content-type": "application/json" },
      body: JSON.stringify({ note: "x" }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown-provider" });
  });

  test("mounted under /api/:provider — no session needed, honoPathToRegex matches the :param, rawBody arrives intact through /api/*", async () => {
    const rawBody = JSON.stringify({ event: "payment.succeeded" });
    const res = await stack.app.request("/api/webhooks/stripe", {
      method: "POST",
      headers: { "x-hmac": signHmac(rawBody), "content-type": "application/json" },
      body: rawBody,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ provider: "stripe" });
  });
});

// Type-level contract for ExtraRouteDefinition (kumiko-framework#3050): the
// bodies below are never invoked — tsc checks them, bun:test does not run
// them. Each `@ts-expect-error` turns into an "unused directive" compile
// error if the constraint ever stops firing.
function _requiresEntry(): ExtraRouteDefinition {
  // @ts-expect-error — entry is required; a def without it must not satisfy ExtraRouteDefinition.
  return { method: "GET", path: "/probe", handler: () => new Response() };
}

function _anonymousDepsHaveNoDispatchSystemWrite(): AnonymousExtraRoute {
  return {
    method: "GET",
    path: "/probe",
    entry: "anonymous",
    handler: (c, deps) => {
      // @ts-expect-error — anonymous deps expose systemQuery only, no dispatchSystemWrite.
      void deps.dispatchSystemWrite;
      return c.json({});
    },
  };
}

function _userDepsHaveNoDispatchSystemWrite(): UserExtraRoute {
  return {
    method: "GET",
    path: "/api/probe",
    entry: "user",
    handler: (c, deps) => {
      // @ts-expect-error — user deps expose query/write only, no dispatchSystemWrite.
      void deps.dispatchSystemWrite;
      return c.json({});
    },
  };
}
