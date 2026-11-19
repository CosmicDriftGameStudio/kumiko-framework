// A send that already went out must not be retried because the attempt log
// write failed afterwards: BullMQ would deliver the message a second time.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { DELIVERY_CHANNEL_EXTENSION } from "../constants.ts";
import { deliverySendJob } from "../jobs.ts";
import type { ChannelResult } from "../types.ts";
import { type ChatHarness, setupChatHarness, tenantAdmin } from "./chat-channel-harness.ts";

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

beforeAll(async () => {
  harness = await setupChatHarness(sendProbeFeature);
});

afterAll(async () => {
  await harness.cleanup();
});

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

    await deliverySendJob(
      {
        channelName: "send-log-probe",
        tenantId: tenantAdmin.tenantId,
        recipientId: null,
        notificationType: "app:notify:send-log",
        deliveryAttemptId: "00000000-0000-4000-8000-0000000000dd",
        priority: "normal",
        content: {
          address: "someone",
          message: { notificationType: "app:notify:send-log", title: "X" },
        },
      },
      { ...ctx, registry },
    );

    expect(sendCount).toBe(1);
  });
});
