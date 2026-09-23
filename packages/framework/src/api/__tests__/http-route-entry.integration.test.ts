// kumiko-framework#2885 step 3: `HttpRouteDefinition.anonymous` now controls
// the mount, not just docs/boot-validation. `anonymous: false` must sit
// behind the SAME session-auth chain /api/* uses (no anonymous fallthrough,
// PAT rate limit, origin + CSRF guards) — a request without a session gets
// 401, never a synthesized anonymous user. `anonymous: true` stays public.
//
// anonymousAccess is deliberately wired on the test stack: without it, a
// wrongly-mounted `anonymous: false` route (using jwtGuard instead of
// sessionOnlyGuard) would ALSO 401 on a missing token, masking the bug the
// 401 test exists to catch.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineFeature } from "../../engine";
import type { TenantId } from "../../engine/types/identifiers";
import { setupTestStack, type TestStack, TestUsers } from "../../stack";
import { AUTH_COOKIE_NAME, CSRF_COOKIE_NAME, CSRF_HEADER_NAME, getUser } from "../auth-middleware";

const TENANT_ID = "00000000-0000-4000-8000-000000000001" as TenantId;

const entryFeature = defineFeature("http-route-entry", (r) => {
  r.httpRoute({
    method: "GET",
    path: "/entry-public",
    anonymous: true,
    handler: async (c) => c.json({ ok: true }),
  });
  r.httpRoute({
    method: "GET",
    path: "/entry-private",
    anonymous: false,
    handler: async (c) => c.json({ id: getUser(c).id }),
  });
  r.httpRoute({
    method: "POST",
    path: "/entry-private",
    anonymous: false,
    handler: async (c) => c.json({ id: getUser(c).id }),
  });
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [entryFeature],
    anonymousAccess: { defaultTenantId: TENANT_ID },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("r.httpRoute anonymous:false — session auth chain", () => {
  test("GET without a session → 401, no anonymous fallthrough", async () => {
    const res = await stack.app.request("/entry-private");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("missing_token");
  });

  // Hono answers HEAD through the GET route while c.req.method stays "HEAD";
  // the guard chain must still run for it.
  test("HEAD without a session → 401, not the GET handler unguarded", async () => {
    const res = await stack.app.request("/entry-private", { method: "HEAD" });
    expect(res.status).toBe(401);
  });

  test("GET with a real session → 200, handler sees the logged-in user, not anonymous", async () => {
    const token = await stack.jwt.sign(TestUsers.user);
    const res = await stack.app.request("/entry-private", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(TestUsers.user.id);
    expect(body.id).not.toBe("anonymous");
  });

  test("POST with cookie auth, no CSRF token → 403 csrf_token_mismatch", async () => {
    const token = await stack.jwt.sign(TestUsers.user);
    const res = await stack.app.request("/entry-private", {
      method: "POST",
      headers: { Cookie: `${AUTH_COOKIE_NAME}=${token}` },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("csrf_token_mismatch");
  });

  test("POST with cookie auth + matching CSRF token → 200", async () => {
    const token = await stack.jwt.sign(TestUsers.user);
    const csrf = "csrf-fixed-http-route-entry-token";
    const res = await stack.app.request("/entry-private", {
      method: "POST",
      headers: {
        Cookie: `${AUTH_COOKIE_NAME}=${token}; ${CSRF_COOKIE_NAME}=${csrf}`,
        [CSRF_HEADER_NAME]: csrf,
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(TestUsers.user.id);
  });
});

describe("r.httpRoute anonymous:true — stays public", () => {
  test("GET without a session → 200", async () => {
    const res = await stack.app.request("/entry-public");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
