import { afterEach, describe, expect, test } from "bun:test";
import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import {
  createTierEngineFeature,
  type TierMap,
} from "@cosmicdrift/kumiko-bundled-features/tier-engine";
import { defineFeature, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { seedTenant, setupAppTestStack } from "../testing.ts";

const PING_QN = "feat-pro:query:ping";

const tierMap: TierMap<Record<string, never>> = {
  free: { features: [], caps: {} },
  pro: { features: ["feat-pro"], caps: {} },
};

function featProFeature() {
  return defineFeature("feat-pro", (r) => {
    r.toggleable({ default: false });
    r.queryHandler(
      defineQueryHandler({
        name: "ping",
        schema: z.object({}),
        access: { roles: ["TenantAdmin"] },
        handler: async () => ({ isSuccess: true as const, data: { pong: true } }),
      }),
    );
  });
}

let stack: TestStack | undefined;

afterEach(async () => {
  await stack?.cleanup();
  stack = undefined;
});

describe("setupAppTestStack tier-engine", () => {
  test("a tenant without a tier is refused a tier feature until it is assigned pro", async () => {
    stack = await setupAppTestStack([
      createConfigFeature(),
      createTierEngineFeature({ tierMap }),
      featProFeature(),
    ]);
    const tenant = await seedTenant(stack, { persist: true });
    const admin = tenant.admin.session;

    const refused = await stack.http.query(PING_QN, {}, admin);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: "feature_disabled" } });

    await stack.http.writeOk(
      "tier-engine:write:tier-assignment:create",
      { tier: "pro" },
      createTestUser({ id: 9001, tenantId: tenant.id, roles: ["SystemAdmin", "TenantAdmin"] }),
    );

    expect((await stack.http.query(PING_QN, {}, admin)).status).toBe(200);
  });

  test("the trial opens the trial tier for a freshly seeded tenant", async () => {
    stack = await setupAppTestStack([
      createConfigFeature(),
      createTierEngineFeature({ tierMap, trial: { tier: "pro", durationHours: 720 } }),
      featProFeature(),
    ]);
    const tenant = await seedTenant(stack, { persist: true });

    expect((await stack.http.query(PING_QN, {}, tenant.admin.session)).status).toBe(200);
  });

  test("an explicit effectiveFeatures replaces the tier resolver", async () => {
    stack = await setupAppTestStack(
      [createConfigFeature(), createTierEngineFeature({ tierMap }), featProFeature()],
      { effectiveFeatures: () => new Set(["feat-pro"]) },
    );
    const admin = createTestUser({ id: 9002, tenantId: testTenantId(1), roles: ["TenantAdmin"] });

    expect((await stack.http.query(PING_QN, {}, admin)).status).toBe(200);
  });
});
