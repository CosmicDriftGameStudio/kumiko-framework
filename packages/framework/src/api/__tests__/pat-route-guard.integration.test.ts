// PAT route-scoping (fail-closed): a Personal Access Token must only reach
// the dispatcher routes (write/batch/query/command/stream) — every other
// /api/* surface, and every non-anonymous r.httpRoute regardless of where
// it's mounted, is off-limits no matter what the token's granted scopes are.
// Full HTTP loop via setupTestStack (real buildServer wiring), never
// createTestDispatcher — this proves the guard is actually mounted, not just
// that the guard function works in isolation.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as z from "zod";
import { defineFeature, type SessionUser } from "../../engine/index.js";
import type { TenantId } from "../../engine/types/identifiers.js";
import { setupTestStack, type TestStack, TestUsers } from "../../stack/index.js";
import type { TokenVerifier } from "../auth-middleware.js";
import type { UserExtraRoute } from "../extra-route.js";

const TENANT_ID = "00000000-0000-4000-8000-000000000001" as TenantId;
const PAT_TEST_TOKEN = "kpat_route-guard-test-token";

const patTestUser: SessionUser = {
  id: "pat-route-guard-test-user",
  tenantId: TENANT_ID,
  roles: [],
  pat: {
    tokenId: "pat-route-guard-test-token-id",
    scopes: ["ping:read"],
    allowedQns: ["pat-route-guard-probe:query:ping"],
  },
};

const fakeTokenVerifier: TokenVerifier = async (raw) =>
  raw === PAT_TEST_TOKEN ? patTestUser : null;

const probeFeature = defineFeature("pat-route-guard-probe", (r) => {
  r.queryHandler({
    name: "ping",
    schema: z.object({}),
    access: { openToAll: { reason: "test handler callable by any authenticated caller" } },
    handler: async () => ({ pong: true }),
  });
  r.httpRoute({
    method: "GET",
    path: "/pat-guard-private",
    anonymous: false,
    handler: async (c) => c.json({ ok: true }),
  });
});

const userExtraRoute: UserExtraRoute = {
  method: "GET",
  path: "/api/pat-guard-extra",
  entry: "user",
  handler: async (c) => c.json({ ok: true }),
};

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [probeFeature],
    extraRoutes: [userExtraRoute],
    authConfig: {
      // Never actually dispatched in these tests (login/tenant-switch aren't
      // exercised here) — only tokenVerifier matters for the PAT path.
      membershipQuery: "pat-route-guard-probe:query:nonexistent",
      tokenVerifier: fakeTokenVerifier,
    },
  });
});

afterAll(() => stack.cleanup());

function patHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${PAT_TEST_TOKEN}` };
}

describe("PAT route guard — dispatcher routes only", () => {
  test("PAT with a matching scope still reaches /api/query (regression)", async () => {
    const res = await stack.app.request("/api/query", {
      method: "POST",
      headers: { ...patHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ type: "pat-route-guard-probe:query:ping", payload: {} }),
    });
    expect(res.status).toBe(200);
  });

  test("PAT → GET /api/sse → 403 before the stream ever opens", async () => {
    const res = await stack.app.request("/api/sse", { headers: patHeaders() });
    expect(res.status).toBe(403);
    const body = (await res.json()) as {
      error: { code: string; details?: { reason?: string } };
    };
    expect(body.error.code).toBe("access_denied");
    expect(body.error.details?.reason).toBe("pat_dispatcher_routes_only");
  });

  test("PAT → non-anonymous r.httpRoute → 403", async () => {
    const res = await stack.app.request("/pat-guard-private", { headers: patHeaders() });
    expect(res.status).toBe(403);
    const body = (await res.json()) as {
      error: { code: string; details?: { reason?: string } };
    };
    expect(body.error.code).toBe("access_denied");
    expect(body.error.details?.reason).toBe("pat_dispatcher_routes_only");
  });

  test("JWT user still reaches the same r.httpRoute (regression)", async () => {
    const token = await stack.jwt.sign(TestUsers.user);
    const res = await stack.app.request("/pat-guard-private", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  test('PAT → entry:"user" extraRoute → 403', async () => {
    const res = await stack.app.request("/api/pat-guard-extra", { headers: patHeaders() });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("access_denied");
  });

  test('JWT user still reaches the entry:"user" extraRoute (regression)', async () => {
    const token = await stack.jwt.sign(TestUsers.user);
    const res = await stack.app.request("/api/pat-guard-extra", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });
});
