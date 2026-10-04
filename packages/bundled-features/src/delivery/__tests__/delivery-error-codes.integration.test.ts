// Delivery stores and returns only fixed error codes. A channel that throws with a
// provider URL (token in the path) and a recipient address in its message must not
// leak either into the attempt row, the event, NotifyResult or the job failure.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  defineFeature,
  defineWriteHandler,
  type NotifyFn,
  type NotifyResult,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import type { Logger } from "@cosmicdrift/kumiko-framework/logging";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import * as z from "zod";
import { createConfigFeature } from "../../config/feature.js";
import { createTenantFeature } from "../../tenant/feature.js";
import { DELIVERY_CHANNEL_EXTENSION } from "../constants.js";
import { createDeliveryFeature } from "../feature.js";
import { deliveryAttemptsTable } from "../tables.js";
import { createDeliveryTestContext } from "../testing.js";

const LEAKY_MESSAGE =
  "POST https://hooks.example.com/services/SECRET123 failed for ops@example.com";
const admin = createTestUser({ roles: ["TenantAdmin"] });

const logged: string[] = [];
const recordingLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  debug: () => undefined,
  error: (msg) => {
    logged.push(msg);
  },
  child: () => recordingLogger,
};

function leakyChannelFeature(name: string, behavior: "send" | "render", mode: "inline" | "queued") {
  return defineFeature(name, (r) => {
    r.requires("delivery");
    r.useExtension(DELIVERY_CHANNEL_EXTENSION, name, {
      mode,
      render: async () => {
        if (behavior === "render") throw new Error(LEAKY_MESSAGE);
        return { html: "<p>x</p>", subject: "x" };
      },
      send: async () => {
        if (behavior === "send") throw new Error(LEAKY_MESSAGE);
        return { status: "sent" };
      },
    });
  });
}

const probeFeature = defineFeature("codes-probe", (r) => {
  r.requires("delivery");
  r.writeHandler(
    defineWriteHandler({
      name: "ping",
      schema: z.object({
        channel: z.string(),
        notificationType: z.string(),
        immediate: z.boolean().optional(),
      }),
      access: { roles: ["TenantAdmin"] },
      handler: async (event, ctx) => {
        const notify = ctx.notify as NotifyFn;
        const result = await notify(event.payload.notificationType, {
          route: { [event.payload.channel]: "somewhere" },
          data: { title: "ping" },
          ...(event.payload.immediate && { immediate: true }),
        });
        return { isSuccess: true, data: result };
      },
    }),
  );
});

async function buildStack(withJobs: boolean): Promise<TestStack> {
  const stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createDeliveryFeature(),
      leakyChannelFeature("leaky-send", "send", "queued"),
      leakyChannelFeature("leaky-render", "render", "queued"),
      probeFeature,
    ],
    ...(withJobs && { jobs: { consumerLane: "worker" } }),
    extraContext: (deps) => createDeliveryTestContext(deps, { log: recordingLogger }),
  });
  await unsafePushTables(stack.db, { deliveryAttemptsTable });
  return stack;
}

async function expectNoLeak(stack: TestStack, notificationType: string, code: string) {
  const rows = await selectMany<{ status: string; error: string | null }>(
    stack.db,
    deliveryAttemptsTable,
    { notificationType },
  );
  expect(rows.map((r) => [r.status, r.error])).toEqual([["failed", code]]);
  const events = await selectMany(stack.db, eventsTable, { aggregateType: "deliveryAttempt" });
  const payloads = events.map((e) => JSON.stringify(e.payload));
  const mine = payloads.filter((p) => p.includes(notificationType));
  expect(mine.length).toBeGreaterThan(0);
  const serialized = JSON.stringify([rows, mine]);
  expect(serialized).not.toContain("SECRET123");
  expect(serialized).not.toContain("ops@example.com");
}

describe("inline path (no job runner)", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await buildStack(false);
  });
  afterAll(async () => {
    await stack.cleanup();
  });

  test.each([
    ["leaky-send", "send_failed"],
    ["leaky-render", "render_failed"],
  ])("%s -> %s in result, row and event; log message is redacted", async (channel, code) => {
    logged.length = 0;
    const notificationType = `app:notify:codes-${channel}`;

    const result = await stack.http.writeOk<NotifyResult>(
      "codes-probe:write:ping",
      { channel, notificationType, immediate: true },
      admin,
    );

    expect(result.deliveries.map((d) => [d.status, String(d.error)])).toEqual([["failed", code]]);
    await expectNoLeak(stack, notificationType, code);
    const logLine = logged.find((l) => l.includes(code));
    expect(logLine).toBeDefined();
    expect(logLine).toContain("https://hooks.example.com/[redacted]");
    expect(logLine).not.toContain("SECRET123");
    expect(logLine).not.toContain("ops@example.com");
  });
});

describe("job path", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await buildStack(true);
  });
  afterAll(async () => {
    await stack.cleanup();
  });

  test.each([
    ["leaky-send", "send_failed"],
    ["leaky-render", "render_failed"],
  ])("%s -> %s on the attempt; the job failure carries no raw text", async (channel, code) => {
    const notificationType = `app:notify:codes-job-${channel}`;
    await stack.http.writeOk("codes-probe:write:ping", { channel, notificationType }, admin);

    const drainError = await stack.drainJobs().then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(drainError).toBeInstanceOf(Error);
    expect(String((drainError as Error).message)).not.toContain("SECRET123");
    expect(String((drainError as Error).message)).not.toContain("ops@example.com");
    await expectNoLeak(stack, notificationType, code);
  });
});
