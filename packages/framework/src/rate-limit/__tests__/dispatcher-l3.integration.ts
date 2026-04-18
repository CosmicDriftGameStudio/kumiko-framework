import { defineFeature } from "@kumiko/framework/engine";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { createTestUser, setupTestStack, type TestStack, TestUsers } from "../../testing";

// Full-stack L3 proof: a handler with `rateLimit` opt-in is gated by the
// dispatcher BEFORE its handler-fn runs. After `limit` calls within the
// window the next call surfaces a 429-shaped error response.

const userOpsLimited = defineFeature("rl-test", (r) => {
  r.queryHandler(
    "ping",
    z.object({}),
    async () => ({ ok: true }),
    {
      access: { roles: ["Admin"] },
      rateLimit: { per: "user", limit: 3, windowSeconds: 60 },
    },
  );
  r.queryHandler(
    "open",
    z.object({}),
    async () => ({ ok: true }),
    {
      // No rateLimit option — proves opt-in: this handler stays
      // unlimited even though the same user just got blocked on `ping`.
      access: { roles: ["Admin"] },
    },
  );
});

let stack: TestStack;
const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({ features: [userOpsLimited] });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  // Each test starts with a fresh bucket — no carry-over between tests.
  await stack.redis.flushNamespace();
});

describe("dispatcher L3 — handler rateLimit opt-in", () => {
  test("3 calls allowed, 4th call returns rate_limited error response", async () => {
    for (let i = 0; i < 3; i++) {
      const ok = await stack.http.queryOk("rl-test:query:ping", {}, admin);
      expect(ok).toEqual({ ok: true });
    }

    // The 4th query goes through queryRaw so we can inspect the wire
    // shape — queryOk would throw on a non-2xx response, masking the
    // actual error body.
    const res = await stack.http.query("rl-test:query:ping", {}, admin);
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { code: string; details?: { bucket?: string } } };
    expect(body.error.code).toBe("rate_limited");
    expect(body.error.details?.bucket).toBe(`u:${admin.id}`);
  });

  test("isolates per user: blocked user does not block other user", async () => {
    const otherAdmin = createTestUser({ id: 9001, roles: ["Admin"] });

    for (let i = 0; i < 3; i++) {
      await stack.http.queryOk("rl-test:query:ping", {}, admin);
    }
    const blocked = await stack.http.query("rl-test:query:ping", {}, admin);
    expect(blocked.status).toBe(429);

    const otherOk = await stack.http.queryOk("rl-test:query:ping", {}, otherAdmin);
    expect(otherOk).toEqual({ ok: true });
  });

  test("same user, different handler without rateLimit: stays unlimited", async () => {
    for (let i = 0; i < 3; i++) {
      await stack.http.queryOk("rl-test:query:ping", {}, admin);
    }
    const blocked = await stack.http.query("rl-test:query:ping", {}, admin);
    expect(blocked.status).toBe(429);

    // The "open" handler has no rateLimit declaration → bucket is
    // independent → admin can still call it freely.
    for (let i = 0; i < 5; i++) {
      const ok = await stack.http.queryOk("rl-test:query:open", {}, admin);
      expect(ok).toEqual({ ok: true });
    }
  });
});
