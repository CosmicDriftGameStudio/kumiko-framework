import { afterEach, describe, expect, test } from "bun:test";
import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import {
  defineFeature,
  defineQueryHandler,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { setupAppTestStack } from "../testing.ts";

function gadgetFeature() {
  return defineFeature("gadget", (r) => {
    r.systemScope();
    r.toggleable({ default: true });
    r.queryHandler(
      defineQueryHandler({
        name: "ping",
        schema: z.object({}),
        access: { openToAll: { reason: "test probe" } },
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

describe("setupAppTestStack featureToggles", () => {
  const sysAdmin = createTestUser({ id: 1, tenantId: SYSTEM_TENANT_ID, roles: ["SystemAdmin"] });
  const member = createTestUser({ id: 2, tenantId: testTenantId(1), roles: ["Member"] });

  test("a feature switched off is unreachable for every tenant, one switched on stays reachable", async () => {
    stack = await setupAppTestStack([createConfigFeature(), gadgetFeature()], {
      featureToggles: true,
    });
    expect((await stack.http.query("gadget:query:ping", {}, member)).status).toBe(200);

    await stack.http.writeOk(
      "feature-toggles:write:set",
      { featureName: "gadget", enabled: false },
      sysAdmin,
    );

    const response = await stack.http.query("gadget:query:ping", {}, member);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "feature_disabled" } });
  });

  test("without the option the switch feature is not mounted", async () => {
    stack = await setupAppTestStack([createConfigFeature(), gadgetFeature()]);
    expect(stack.registry.getFeature("feature-toggles")).toBeUndefined();
  });
});
