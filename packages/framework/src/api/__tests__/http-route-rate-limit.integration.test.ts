// kumiko-framework#1977: r.httpRoute's systemQuery used to always run with
// requestContext.get()?.ip === undefined, so a `rateLimit: {per: "ip"}`
// handler invoked through it silently never bucketed — see server.ts's
// systemQuery wiring. Proves the fix: repeated calls through the same
// httpRoute, same client IP, DO hit the limit.

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";
import * as z from "zod";
import { createEntity, createTextField, defineFeature } from "../../engine/index.js";
import type { TenantId } from "../../engine/types/identifiers.js";
import { RateLimitError } from "../../errors/index.js";
import { setupTestStack, type TestStack } from "../../stack/index.js";

const SYSTEM_TENANT_ID = "00000000-0000-4000-8000-000000000000" as TenantId;

const ipLimitedFeature = defineFeature("rl-http", (r) => {
  r.entity(
    "item",
    createEntity({
      table: "Items",
      fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
    }),
  );
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
  // trustedProxyHops: 1 — this suite's whole point is isolating buckets by
  // the literal x-forwarded-for value below; the
  // new hops=0 default ignores that header outright.
  stack = await setupTestStack({ features: [ipLimitedFeature], trustedProxyHops: 1 });
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

  // An attacker rotating the untrusted, client-facing XFF prefix must still
  // land in the real client's bucket — only the
  // trusted-proxy-appended LAST entry counts at hops=1.
  test("hops=1: different spoofed leading XFF entry, same trailing entry → same bucket", async () => {
    const attempt = (leading: string) =>
      stack.app.request("/ping", { headers: { "x-forwarded-for": `${leading}, 9.9.9.4` } });

    expect((await attempt("attacker-claim-a")).status).toBe(200);
    expect((await attempt("attacker-claim-b")).status).toBe(200);
    const third = await attempt("attacker-claim-c");
    expect(third.status).toBe(429);
  });
});

describe("r.httpRoute → systemQuery: default trustedProxyHops=0 never fail-opens", () => {
  let defaultHopsStack: TestStack;

  beforeAll(async () => {
    defaultHopsStack = await setupTestStack({ features: [ipLimitedFeature] });
  });

  afterAll(async () => {
    await defaultHopsStack.cleanup();
  });

  beforeEach(async () => {
    await defaultHopsStack.redis.flushNamespace();
  });

  test("no x-forwarded-for at all: the shared 'unknown' bucket still enforces the limit", async () => {
    const call = () => defaultHopsStack.app.request("/ping");

    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(429);
  });

  describe("one-time warning when hops=0 but the client sends x-forwarded-for anyway", () => {
    let warnSpy: ReturnType<typeof spyOn>;

    afterEach(() => {
      warnSpy?.mockRestore();
    });

    test("warns exactly once across multiple requests, not once per request", async () => {
      warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      const call = () =>
        defaultHopsStack.app.request("/ping", { headers: { "x-forwarded-for": "203.0.113.50" } });

      await call();
      await call();

      const proxyWarnings = warnSpy.mock.calls.filter((args: unknown[]) =>
        String(args[0]).includes("trustedProxyHops is 0"),
      );
      expect(proxyWarnings.length).toBe(1);
    });
  });
});
