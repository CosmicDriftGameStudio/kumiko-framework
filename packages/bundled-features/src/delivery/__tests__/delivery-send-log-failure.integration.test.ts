// A send that already went out must not be retried because the attempt log
// write failed afterwards: BullMQ would deliver the message a second time.
// Adapter and log-write error texts can carry names or phone numbers, so the job logs only their class.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import type { Logger } from "@cosmicdrift/kumiko-framework/logging";
import { DELIVERY_CHANNEL_EXTENSION } from "../constants.ts";
import { deliverySendJob } from "../jobs.ts";
import type { ChannelResult } from "../types.ts";
import { type ChatHarness, setupChatHarness, tenantAdmin } from "./chat-channel-harness.ts";

const PII_TEXT = "Max Mustermann +49 170 1234567";

let harness: ChatHarness;
let sendCount = 0;
let sendCompleted = false;

const sendProbeFeature = defineFeature("send-log-probe", (r) => {
  r.requires({ features: ["delivery"] });
  r.applyExtension({
    name: DELIVERY_CHANNEL_EXTENSION,
    entity: "send-log-probe",
    mode: "queued",
    send: async (): Promise<ChannelResult> => {
      sendCount++;
      sendCompleted = true;
      return { status: "sent" };
    },
  });
});

const throwingProbeFeature = defineFeature("send-throw-probe", (r) => {
  r.requires({ features: ["delivery"] });
  r.applyExtension({
    name: DELIVERY_CHANNEL_EXTENSION,
    entity: "send-throw-probe",
    mode: "queued",
    send: async (): Promise<ChannelResult> => {
      throw Object.assign(new TypeError(PII_TEXT), { code: "ECONNRESET" });
    },
  });
});

beforeAll(async () => {
  harness = await setupChatHarness(sendProbeFeature, throwingProbeFeature);
});

afterAll(async () => {
  await harness.cleanup();
});

function recordingLogger(lines: string[]): Logger {
  const record = (msg: string, data?: Record<string, unknown>) => {
    lines.push(`${msg} ${JSON.stringify(data ?? {})}`);
  };
  const logger: Logger = {
    info: record,
    warn: record,
    error: record,
    debug: record,
    child: () => logger,
  };
  return logger;
}

function sendPayload(channelName: string) {
  return {
    channelName,
    tenantId: tenantAdmin.tenantId,
    recipientId: null,
    notificationType: "app:notify:send-log",
    deliveryAttemptId: "00000000-0000-4000-8000-0000000000dd",
    priority: "normal",
    content: {
      address: "someone",
      message: { notificationType: "app:notify:send-log", title: "X" },
    },
  };
}

describe("delivery.send when the attempt log write fails after the send", () => {
  test("the job completes instead of failing into a re-send", async () => {
    sendCount = 0;
    sendCompleted = false;
    const ctx = harness.buildJobContext();
    // Only the log write after the send reads the channel extensions again.
    const registry = new Proxy(ctx.registry, {
      get(target, prop, receiver) {
        if (prop === "getExtensionUsages" && sendCompleted) {
          return () => {
            throw new Error("attempt log down");
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    await deliverySendJob(sendPayload("send-log-probe"), { ...ctx, registry });

    expect(sendCount).toBe(1);
  });

  test("the log names the error class, not the error text", async () => {
    sendCount = 0;
    sendCompleted = false;
    const lines: string[] = [];
    const ctx = harness.buildJobContext();
    const registry = new Proxy(ctx.registry, {
      get(target, prop, receiver) {
        if (prop === "getExtensionUsages" && sendCompleted) {
          return () => {
            throw new Error(PII_TEXT);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    await deliverySendJob(sendPayload("send-log-probe"), {
      ...ctx,
      registry,
      obs: { ...ctx.obs, log: recordingLogger(lines) },
    });

    const logged = lines.join("\n");
    expect(logged).toContain("sent but attempt log failed: Error");
    expect(logged).not.toContain("Mustermann");
    expect(logged).not.toContain("1234567");
  });
});

describe("delivery.send when the channel adapter throws", () => {
  test("the log names the error class and code, not the adapter text", async () => {
    const lines: string[] = [];
    const ctx = harness.buildJobContext();

    await expect(
      deliverySendJob(sendPayload("send-throw-probe"), {
        ...ctx,
        obs: { ...ctx.obs, log: recordingLogger(lines) },
      }),
    ).rejects.toThrow(/^send_failed$/);

    const logged = lines.join("\n");
    expect(logged).toContain("send_failed: TypeError (ECONNRESET)");
    expect(logged).not.toContain("Mustermann");
    expect(logged).not.toContain("1234567");
  });
});
