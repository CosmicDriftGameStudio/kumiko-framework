// runDevApp understands the same declarative boot options as runProdApp, through the same
// resolve* functions: each option below changes what the booted dev server mounts or does.

import { afterEach, describe, expect, test } from "bun:test";
import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import { createDeliveryFeature } from "@cosmicdrift/kumiko-bundled-features/delivery";
import { createFileFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/file-foundation";
import { createTenantFeature } from "@cosmicdrift/kumiko-bundled-features/tenant";
import {
  createEntity,
  createTextField,
  defineFeature,
  defineQueryHandler,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { composeEnvSchema } from "@cosmicdrift/kumiko-framework/env";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import * as z from "zod";
import type { KumikoServerHandle } from "../create-kumiko-server.ts";
import { runDevApp } from "../run-dev-app.ts";

const PLAINTEXT_REASON = "test: boot options focus, not PII crypto";

function shopFeature() {
  return defineFeature("shop", (r) => {
    r.entity({
      name: "product",
      ...createEntity({
        fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
      }),
    });
  });
}

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

let handle: KumikoServerHandle | undefined;

afterEach(async () => {
  await handle?.stop();
  handle = undefined;
});

describe("runDevApp boot options", () => {
  test("mail mounts channel-email", async () => {
    handle = await runDevApp({
      features: [
        shopFeature(),
        createConfigFeature(),
        createTenantFeature(),
        createDeliveryFeature(),
      ],
      port: 0,
      kmsMode: { plaintextReason: PLAINTEXT_REASON },
      mail: { transport: "inmemory" },
    });
    expect(handle.stack.registry.getFeature("channel-email")).toBeDefined();
  });

  test("fileStorage mounts the chosen provider", async () => {
    handle = await runDevApp({
      features: [shopFeature(), createConfigFeature(), createFileFoundationFeature()],
      port: 0,
      kmsMode: { plaintextReason: PLAINTEXT_REASON },
      fileStorage: { provider: "inmemory" },
    });
    expect(handle.stack.registry.getFeature("file-provider-inmemory")).toBeDefined();
  });

  test("kmsMode required without the KMS env aborts the boot", async () => {
    await expect(
      runDevApp({ features: [shopFeature()], port: 0, kmsMode: "required", envSource: {} }),
    ).rejects.toThrow(/kmsMode "required"/);
  });

  test("the removed effectiveFeatures option aborts the boot", async () => {
    const removedOption = { effectiveFeatures: () => new Set<string>() };
    await expect(
      runDevApp({ features: [shopFeature()], port: 0, envSource: {}, ...removedOption }),
    ).rejects.toThrow(/featureToggles: true/);
  });

  test("kmsMode with a plaintext reason boots without an in-memory KMS", async () => {
    handle = await runDevApp({
      features: [shopFeature()],
      port: 0,
      kmsMode: { plaintextReason: PLAINTEXT_REASON },
    });
    expect(handle).toBeDefined();
  });

  test("billing without tier-engine aborts and names the missing feature", async () => {
    await expect(
      runDevApp({
        features: [shopFeature()],
        port: 0,
        kmsMode: { plaintextReason: PLAINTEXT_REASON },
        billing: { stripe: { priceToTier: {} }, defaultTier: "free" },
      }),
    ).rejects.toThrow(/createTierEngineFeature/);
  });

  test("seeds.run seeds get the booted stack", async () => {
    let seededWith: unknown;
    handle = await runDevApp({
      features: [shopFeature()],
      port: 0,
      kmsMode: { plaintextReason: PLAINTEXT_REASON },
      seeds: {
        run: [
          async (stack) => {
            seededWith = stack;
          },
        ],
      },
    });
    expect(seededWith).toBe(handle.stack);
  });

  test("demoMode blocks writes and serves the notice", async () => {
    handle = await runDevApp({
      features: [shopFeature()],
      port: 0,
      kmsMode: { plaintextReason: PLAINTEXT_REASON },
      demoMode: { readOnly: true, notice: { text: { en: "Read-only demo" } } },
    });
    const blocked = await handle.fetch(
      new Request("http://test/api/write", { method: "POST", body: "{}" }),
    );
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({ error: { code: "demo_read_only" } });

    const notice = await handle.fetch(new Request("http://test/demo-mode"));
    expect(notice.status).toBe(200);
  });

  test("envSchema aborts the boot when a required variable is missing", async () => {
    const envSchema = composeEnvSchema({
      features: [],
      extend: z.object({ DEV_BOOT_OPTIONS_REQUIRED: z.string() }),
    });
    await expect(
      runDevApp({
        features: [shopFeature()],
        port: 0,
        kmsMode: { plaintextReason: PLAINTEXT_REASON },
        envSchema,
        envSource: {},
      }),
    ).rejects.toThrow(/DEV_BOOT_OPTIONS_REQUIRED/);
  });
});

describe("runDevApp featureToggles", () => {
  const sysAdmin = createTestUser({ id: 1, tenantId: SYSTEM_TENANT_ID, roles: ["SystemAdmin"] });
  const members = [
    createTestUser({ id: 2, tenantId: testTenantId(1), roles: ["Member"] }),
    createTestUser({ id: 3, tenantId: testTenantId(2), roles: ["Member"] }),
  ];

  test("switching a feature off globally answers feature_disabled for every tenant", async () => {
    handle = await runDevApp({
      features: [createConfigFeature(), gadgetFeature()],
      port: 0,
      kmsMode: { plaintextReason: PLAINTEXT_REASON },
      featureToggles: true,
    });
    const { http } = handle.stack;
    for (const member of members) {
      expect((await http.query("gadget:query:ping", {}, member)).status).toBe(200);
    }

    await http.writeOk(
      "feature-toggles:write:set",
      { featureName: "gadget", enabled: false },
      sysAdmin,
    );

    for (const member of members) {
      const response = await http.query("gadget:query:ping", {}, member);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "feature_disabled" } });
    }
  });
});
