import { defineFeature, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { createTestUser, TestUsers } from "../../stack";
import { setupTestStack, type TestStack } from "../../stack";

// Full-stack L3 proof: a handler with `rateLimit` opt-in is gated by the
// dispatcher BEFORE its handler-fn runs. After `limit` calls within the
// window the next call surfaces a 429-shaped error response.

// obj-form handler — proves defineQueryHandler({ ..., rateLimit })
// reaches the dispatcher with the option intact. Inline-form once
// silently dropped rateLimit because the spread missed it; obj-form
// goes through a different path so we need a dedicated test.
const objFormPing = defineQueryHandler({
  name: "obj-ping",
  schema: z.object({}),
  access: { roles: ["Admin"] },
  rateLimit: { per: "user", limit: 2, windowSeconds: 60 },
  handler: async () => ({ ok: true }),
});

const userOpsLimited = defineFeature("rl-test", (r) => {
  r.queryHandler("ping", z.object({}), async () => ({ ok: true }), {
    access: { roles: ["Admin"] },
    rateLimit: { per: "user", limit: 3, windowSeconds: 60 },
  });
  r.queryHandler("open", z.object({}), async () => ({ ok: true }), {
    // No rateLimit option — proves opt-in: this handler stays
    // unlimited even though the same user just got blocked on `ping`.
    access: { roles: ["Admin"] },
  });
  r.queryHandler(objFormPing);
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
    expect(body.error.details?.bucket).toBe(`user:${admin.id}`);
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

  test("obj-form defineQueryHandler propagates rateLimit through to dispatcher", async () => {
    // 2 calls allowed (limit on the obj-form definition is 2/min/user).
    for (let i = 0; i < 2; i++) {
      const ok = await stack.http.queryOk("rl-test:query:obj-ping", {}, admin);
      expect(ok).toEqual({ ok: true });
    }
    const blocked = await stack.http.query("rl-test:query:obj-ping", {}, admin);
    // 429 here proves the obj-form path didn't silently drop rateLimit.
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as {
      error: { code: string; details?: { limit?: number } };
    };
    expect(body.error.code).toBe("rate_limited");
    expect(body.error.details?.limit).toBe(2);
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
