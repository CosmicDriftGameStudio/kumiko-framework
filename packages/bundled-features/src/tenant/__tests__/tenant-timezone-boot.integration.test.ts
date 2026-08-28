// Regression guard for fw#1648: dispatch-shared.ts hardcodes the literal
// "tenant:config:timezone" (TENANT_TIMEZONE_CONFIG_KEY) since framework/pipeline
// can't import the bundled `tenant` feature. tz-resolution.integration.test.ts
// exercises that literal against a standalone probe feature, which can't see a
// drift to the REAL tenant feature's key name — this test boots the actual
// createTenantFeature() instead.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { z } from "zod";
import { createConfigAccessorFactory, createConfigFeature } from "../../config/feature";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createTenantFeature } from "../feature";

const probeFeature = defineFeature("tz-probe", (r) => {
  r.requires("tenant");
  r.writeHandler(
    "read-tz",
    z.object({}),
    async (_event, ctx) => ({ isSuccess: true, data: { tenant: ctx.tz.tenant } }),
    { access: { openToAll: true } },
  );
});

// Query (not write) probe for the caching tests below: dispatcher.query()
// never opens a transaction, which is the hot path fw#2462 targets and the
// only path buildHandlerContext is allowed to populate the cache from.
const queryProbeFeature = defineFeature("tz-cache-probe", (r) => {
  r.requires("tenant");
  r.queryHandler("read-tz", z.object({}), async (_query, ctx) => ({ tenant: ctx.tz.tenant }), {
    access: { openToAll: true },
  });
});

describe("ctx.tz.tenant against the real tenant feature (fw#1648)", () => {
  let stack: TestStack;

  beforeAll(async () => {
    const resolver = createConfigResolver();
    stack = await setupTestStack({
      features: [createConfigFeature(), createTenantFeature(), probeFeature],
      extraContext: ({ registry }) => ({
        configResolver: resolver,
        _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
      }),
    });
    await unsafePushTables(stack.db, { configValuesTable });
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("ctx.tz.tenant reflects tenant:config:timezone set via the real tenant feature", async () => {
    const admin = createTestUser({ id: 20, roles: ["Admin"] });
    await stack.http.writeOk(
      "config:write:set",
      { key: "tenant:config:timezone", value: "Asia/Tokyo" },
      admin,
    );
    const res = await stack.http.writeOk<{ tenant: string }>("tz-probe:write:read-tz", {}, admin);
    expect(res.tenant).toBe("Asia/Tokyo");
  });
});

// fw#2462: dispatch-shared.ts now caches the resolved tenant:config:timezone
// value per tenant instead of resolving it on every dispatch. These tests
// prove the cache is actually consulted (config() isn't re-invoked on a
// repeat read) and that config:write:set/reset correctly invalidate it —
// own stack per describe so cache state never leaks across test files.
describe("tenant:config:timezone dispatch cache (fw#2462)", () => {
  let stack: TestStack;
  let configCallCount: number;

  beforeAll(async () => {
    const resolver = createConfigResolver();
    stack = await setupTestStack({
      features: [createConfigFeature(), createTenantFeature(), queryProbeFeature],
      extraContext: ({ registry }) => {
        const realFactory = createConfigAccessorFactory(registry, resolver);
        // Counts calls through the config accessor — a cache hit in
        // dispatch-shared.ts's buildHandlerContext never reaches this
        // wrapper, so the count is a direct proxy for "did we re-resolve
        // tenant:config:timezone instead of serving it from cache".
        const countingFactory: typeof realFactory = (args) => {
          const accessor = realFactory(args);
          // Probe only ever calls the qualified-string-key overload — the
          // cast sidesteps re-declaring ConfigAccessor's generic handle
          // overload for a test-only wrapper.
          return ((key: string) => {
            configCallCount++;
            return accessor(key);
          }) as typeof accessor; // @cast-boundary test-helper
        };
        return {
          configResolver: resolver,
          _configAccessorFactory: countingFactory,
        };
      },
    });
    await unsafePushTables(stack.db, { configValuesTable });
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("repeat reads for the same tenant are served from cache, not re-resolved", async () => {
    configCallCount = 0;
    const tenantId = testTenantId(101);
    const admin = createTestUser({ id: 21, tenantId, roles: ["Admin"] });

    await stack.http.queryOk("tz-cache-probe:query:read-tz", {}, admin);
    expect(configCallCount).toBe(1);

    await stack.http.queryOk("tz-cache-probe:query:read-tz", {}, admin);
    await stack.http.queryOk("tz-cache-probe:query:read-tz", {}, admin);
    expect(configCallCount).toBe(1);
  });

  test("config:write:set invalidates the cache for the written tenant", async () => {
    configCallCount = 0;
    const tenantId = testTenantId(102);
    const admin = createTestUser({ id: 22, tenantId, roles: ["Admin"] });

    const before = await stack.http.queryOk<{ tenant: string }>(
      "tz-cache-probe:query:read-tz",
      {},
      admin,
    );
    expect(configCallCount).toBe(1);

    await stack.http.writeOk(
      "config:write:set",
      { key: "tenant:config:timezone", value: "Asia/Tokyo" },
      admin,
    );
    expect(before.tenant).not.toBe("Asia/Tokyo");

    const after = await stack.http.queryOk<{ tenant: string }>(
      "tz-cache-probe:query:read-tz",
      {},
      admin,
    );
    expect(after.tenant).toBe("Asia/Tokyo");
    // The cache entry was dropped by the write, so the read after it is a
    // fresh resolve — a second config() call, not a stale cache hit.
    expect(configCallCount).toBe(2);
  });

  test("config:write:reset invalidates the cache for the written tenant", async () => {
    configCallCount = 0;
    const tenantId = testTenantId(103);
    const admin = createTestUser({ id: 23, tenantId, roles: ["Admin"] });

    await stack.http.writeOk(
      "config:write:set",
      { key: "tenant:config:timezone", value: "Asia/Singapore" },
      admin,
    );
    const before = await stack.http.queryOk<{ tenant: string }>(
      "tz-cache-probe:query:read-tz",
      {},
      admin,
    );
    expect(before.tenant).toBe("Asia/Singapore");

    await stack.http.writeOk("config:write:reset", { key: "tenant:config:timezone" }, admin);

    const after = await stack.http.queryOk<{ tenant: string }>(
      "tz-cache-probe:query:read-tz",
      {},
      admin,
    );
    expect(after.tenant).not.toBe("Asia/Singapore");
  });

  test("a system-scope write invalidates every tenant's cached entry, not just the writer's", async () => {
    const tenantA = testTenantId(104);
    const tenantB = testTenantId(105);
    const userA = createTestUser({ id: 24, tenantId: tenantA, roles: ["Admin"] });
    const userB = createTestUser({ id: 25, tenantId: tenantB, roles: ["Admin"] });
    const systemAdmin = createTestUser({ id: 26, tenantId: tenantA, roles: ["SystemAdmin"] });

    // Warm both tenants' cache entries with neither having its own override.
    const beforeA = await stack.http.queryOk<{ tenant: string }>(
      "tz-cache-probe:query:read-tz",
      {},
      userA,
    );
    const beforeB = await stack.http.queryOk<{ tenant: string }>(
      "tz-cache-probe:query:read-tz",
      {},
      userB,
    );
    expect(beforeA.tenant).not.toBe("Australia/Sydney");
    expect(beforeB.tenant).not.toBe("Australia/Sydney");

    await stack.http.writeOk(
      "config:write:set",
      { key: "tenant:config:timezone", value: "Australia/Sydney", scope: "system" },
      systemAdmin,
    );

    const afterA = await stack.http.queryOk<{ tenant: string }>(
      "tz-cache-probe:query:read-tz",
      {},
      userA,
    );
    const afterB = await stack.http.queryOk<{ tenant: string }>(
      "tz-cache-probe:query:read-tz",
      {},
      userB,
    );
    expect(afterA.tenant).toBe("Australia/Sydney");
    expect(afterB.tenant).toBe("Australia/Sydney");
  });
});
