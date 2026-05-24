// Rate-Limiting Showcase — End-to-end proof that all three layers stack.
//
// The boot config below is the same shape a real app would use:
//   buildServer({ ..., rateLimit: { global: ..., auth: ... } })
// L3 comes from the feature itself (handler-declared `rateLimit:`).
//
// One TestStack hosts all three layers. Each test uses a distinct
// bucket dimension (per-user vs per-IP vs per-IP+path) so the layers
// don't shadow each other; beforeEach flushes Redis so counters start
// clean. Limits are picked so the 4th/3rd/21st call is the first 429
// in each layer's test.

import { setupTestStack, type TestStack, TestUsers } from "@cosmicdrift/kumiko-framework/stack";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createRateLimitShowcaseFeature } from "../feature";

let stack: TestStack;
const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createRateLimitShowcaseFeature()],
    rateLimit: {
      // L1: 20/min per IP. High enough that L3 tests (which loop 4×
      // with their own IP) don't accidentally trip L1 first.
      global: { limit: 20, windowSeconds: 60 },
      // L2: 2/min per (IP + path). Default `path: "/api/auth/*"` —
      // tight limit because login brute-force is the canonical use case.
      auth: { path: "/api/auth/*", limit: 2, windowSeconds: 60 },
    },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await stack.redis.flushNamespace();
});

describe("L3 — handler opt-in (per-user budget on expensive-search)", () => {
  test("4th call from same user returns 429 with user-bucket", async () => {
    for (let i = 0; i < 3; i++) {
      const ok = await stack.http.queryOk<{ q: string; hits: number }>(
        "rl-showcase:query:expensive-search",
        { q: "kumiko" },
        admin,
      );
      expect(ok.q).toBe("kumiko");
    }

    // queryOk would throw on non-2xx; query() returns the raw response so
    // the wire-shape of the 429 body is observable.
    const blocked = await stack.http.query(
      "rl-showcase:query:expensive-search",
      { q: "kumiko" },
      admin,
    );
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as {
      error: { code: string; details?: { bucket?: string } };
    };
    expect(body.error.code).toBe("rate_limited");
    expect(body.error.details?.bucket).toBe(`user:${admin.id}`);
  });
});

describe("L1 — global IP middleware (covers every /api/* request)", () => {
  test("21st request from same IP returns 429 with l1:ip bucket", async () => {
    // L1 sits ahead of auth + every /api/* route. Target an authless,
    // routeless path: pre-21st calls pass through L1 and surface a 401
    // from jwtGuard (no token attached). The response code itself
    // doesn't matter — what matters is that the bucket counter advances.
    const ipHeader = { "x-forwarded-for": "10.99.0.1" };
    for (let i = 0; i < 20; i++) {
      const res = await stack.app.request("/api/_probe", { headers: ipHeader });
      expect(res.headers.get("X-RateLimit-Remaining")).toBe(String(19 - i));
    }
    const blocked = await stack.app.request("/api/_probe", { headers: ipHeader });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
    const body = (await blocked.json()) as {
      error: { code: string; details: { bucket: string } };
    };
    expect(body.error.code).toBe("rate_limited");
    expect(body.error.details.bucket).toBe("l1:10.99.0.1");
  });
});

describe("L2 — auth-endpoints middleware (tighter cap on /api/auth/*)", () => {
  test("3rd POST to /api/auth/login from same IP returns 429 with l2:ip:path bucket", async () => {
    const ipHeader = { "x-forwarded-for": "10.99.0.2" };

    // L2 fires before the route resolves. Without an authConfig wired
    // these POSTs would 404, but L2 still counts them — that's the
    // whole point: gate before the request body even gets parsed.
    for (let i = 0; i < 2; i++) {
      const res = await stack.app.request("/api/auth/login", {
        method: "POST",
        headers: ipHeader,
      });
      expect(res.headers.get("X-RateLimit-Remaining")).toBe(String(1 - i));
    }
    const blocked = await stack.app.request("/api/auth/login", {
      method: "POST",
      headers: ipHeader,
    });
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as {
      error: { code: string; details: { bucket: string } };
    };
    expect(body.error.code).toBe("rate_limited");
    expect(body.error.details.bucket).toBe("l2:10.99.0.2:/api/auth/login");
  });
});
