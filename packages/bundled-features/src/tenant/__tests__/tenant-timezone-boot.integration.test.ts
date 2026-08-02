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
