// The prod boot hands the app logger to the delivery service: a failing channel
// is reported to that logger (redacted) and not to the console. Real Postgres,
// real /api/write call, notify wired through buildBootExtraContext.

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
  type NotifyResult,
} from "@cosmicdrift/kumiko-framework/engine";
import type { Logger } from "@cosmicdrift/kumiko-framework/logging";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import * as z from "zod";
import { buildBootExtraContext } from "../run-prod-app.js";

const LEAKY_MESSAGE = "POST https://hooks.example.com/services/SECRET123 failed";
const admin = createTestUser({ roles: ["TenantAdmin"] });

const failedErrors: string[] = [];
const spyLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  debug: () => undefined,
  error: (msg) => {
    failedErrors.push(msg);
  },
  child: () => spyLogger,
};

const leakyChannelFeature = defineFeature("leaky-inline", (r) => {
  r.requires("delivery");
  r.useExtension(DELIVERY_CHANNEL_EXTENSION, "leaky-inline", {
    mode: "inline",
    send: async () => {
      throw new Error(LEAKY_MESSAGE);
    },
  });
});

const probeFeature = defineFeature("boot-logger-probe", (r) => {
  r.requires("delivery");
  r.writeHandler(
    defineWriteHandler({
      name: "ping",
      schema: z.object({}),
      access: { roles: ["TenantAdmin"] },
      handler: async (_event, ctx) => {
        const notify = ctx.notify as NotifyFn;
        const result = await notify("app:notify:boot-logger", {
          route: { "leaky-inline": "somewhere" },
          data: { title: "ping" },
          immediate: true,
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
  leakyChannelFeature,
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
        log: spyLogger,
      }),
  });
  await unsafePushTables(stack.db, { deliveryAttemptsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

test("a failing channel is logged redacted to the boot logger, not the console", async () => {
  const originalConsoleError = console.error;
  const consoleErrors: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    consoleErrors.push(args);
  };
  try {
    const result = await stack.http.writeOk<NotifyResult>(
      "boot-logger-probe:write:ping",
      {},
      admin,
    );

    expect(result.deliveries.map((d) => [d.status, String(d.error)])).toEqual([
      ["failed", "send_failed"],
    ]);
    const line = failedErrors.find((l) => l.includes("send_failed"));
    expect(line).toBeDefined();
    expect(line).not.toContain("SECRET123");
    expect(consoleErrors).toEqual([]);
  } finally {
    console.error = originalConsoleError;
  }
});
