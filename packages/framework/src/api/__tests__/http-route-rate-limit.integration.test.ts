// kumiko-framework#1977: r.httpRoute's systemQuery used to always run with
// requestContext.get()?.ip === undefined, so a `rateLimit: {per: "ip"}`
// handler invoked through it silently never bucketed — see server.ts's
// systemQuery wiring. Proves the fix: repeated calls through the same
// httpRoute, same client IP, DO hit the limit.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { createEntity, createRegistry, createTextField, defineFeature } from "../../engine";
import type { TenantId } from "../../engine/types/identifiers";
import { RateLimitError } from "../../errors";
import { setupTestStack, type TestStack } from "../../stack";

const SYSTEM_TENANT_ID = "00000000-0000-4000-8000-000000000000" as TenantId;

const ipLimitedFeature = defineFeature("rl-http", (r) => {
  r.entity("item", createEntity({ table: "Items", fields: { name: createTextField() } }));
  r.queryHandler("ping", z.object({}), async () => ({ ok: true }), {
    access: { roles: ["anonymous"] },
    rateLimit: { per: "ip", limit: 2, windowSeconds: 60 },
  });
  r.httpRoute({
    method: "GET",
    path: "/ping",
    anonymous: true,
    handler: async (c, deps) => {
      try {
        await deps.systemQuery("rl-http:query:ping", {}, SYSTEM_TENANT_ID);
        return c.json({ ok: true });
      } catch (err) {
        if (err instanceof RateLimitError) return c.json({ ok: false }, 429);
        throw err;
      }
    },
  });
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [ipLimitedFeature] });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await stack.redis.flushNamespace();
});

describe("r.httpRoute → systemQuery propagates requestContext for per-ip rate limiting", () => {
  test("2 calls allowed, 3rd from the same IP is rate-limited", async () => {
    const call = () => stack.app.request("/ping", { headers: { "x-forwarded-for": "9.9.9.1" } });

    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(429);
  });

  test("a different client IP gets its own bucket", async () => {
    const callAs = (ip: string) =>
      stack.app.request("/ping", { headers: { "x-forwarded-for": ip } });

    expect((await callAs("9.9.9.2")).status).toBe(200);
    expect((await callAs("9.9.9.2")).status).toBe(200);
    expect((await callAs("9.9.9.2")).status).toBe(429);

    expect((await callAs("9.9.9.3")).status).toBe(200);
  });
});
