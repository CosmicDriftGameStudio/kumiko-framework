// The boot hands its Redis to the delivery service: notify with an
// idempotencyKey dedups instead of throwing "requires idempotencyRedis".
// Real Postgres + Redis, real /api/write call, notify wired through
// buildBootExtraContext.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import {
  createDeliveryFeature,
  DELIVERY_CHANNEL_EXTENSION,
  deliveryAttemptsTable,
} from "@cosmicdrift/kumiko-bundled-features/delivery";
import { createTenantFeature } from "@cosmicdrift/kumiko-bundled-features/tenant";
import {
  defineFeature,
  defineWriteHandler,
  type NotifyFn,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import * as z from "zod";
import { buildBootExtraContext } from "../run-prod-app.js";

const admin = createTestUser({ roles: ["TenantAdmin"] });

let sendCount = 0;

const countingChannelFeature = defineFeature("counting-inline", (r) => {
  r.requires("delivery");
  r.useExtension(DELIVERY_CHANNEL_EXTENSION, "counting-inline", {
    mode: "inline",
    send: async () => {
      sendCount += 1;
      return { status: "sent" as const };
    },
  });
});

const probeFeature = defineFeature("boot-idempotency-probe", (r) => {
  r.requires("delivery");
  r.writeHandler(
    defineWriteHandler({
      name: "ping",
      schema: z.object({ idempotencyKey: z.string() }),
      access: { roles: ["TenantAdmin"] },
      handler: async (event, ctx) => {
        const notify = ctx.notify as NotifyFn;
        const result = await notify("app:notify:boot-idempotency", {
          route: { "counting-inline": "somewhere" },
          data: { title: "ping" },
          immediate: true,
          idempotencyKey: event.payload.idempotencyKey,
        });
        return { isSuccess: true as const, data: result };
      },
    }),
  );
});

const features = [
  createConfigFeature(),
  createTenantFeature(),
  createDeliveryFeature(),
  countingChannelFeature,
  probeFeature,
];

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features,
    extraContext: (deps) =>
      buildBootExtraContext({
        db: deps.db,
        features,
        envSource: {},
        registry: deps.registry,
        hasAuth: false,
        redis: deps.redis,
      }),
  });
  await unsafePushTables(stack.db, { deliveryAttemptsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

test("two notify calls with the same idempotencyKey deliver once", async () => {
  const payload = { idempotencyKey: "boot-idem-1" };
  sendCount = 0;

  await stack.http.writeOk("boot-idempotency-probe:write:ping", payload, admin);
  await stack.http.writeOk("boot-idempotency-probe:write:ping", payload, admin);

  expect(sendCount).toBe(1);
});
