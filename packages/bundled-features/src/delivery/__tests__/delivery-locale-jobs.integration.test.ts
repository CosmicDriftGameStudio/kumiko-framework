// The notification locale must reach both the channel's render and its send step inside the
// delivery.send job, and a payload without the locale field must still be accepted.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { DELIVERY_CHANNEL_EXTENSION } from "../constants.ts";
import { deliverySendJob } from "../jobs.ts";
import type { ChannelMessage } from "../types.ts";
import { type ChatHarness, setupChatHarness, tenantAdmin } from "./chat-channel-harness.ts";

let harness: ChatHarness;
const localesSeenByRender: (string | undefined)[] = [];
const localesSeenBySend: (string | undefined)[] = [];

const localeProbeFeature = defineFeature("locale-probe", (r) => {
  r.requires({ features: ["delivery"] });
  r.applyExtension({ name: DELIVERY_CHANNEL_EXTENSION, entity: "locale-probe", mode: "queued",
    render: async (message: ChannelMessage) => {
      localesSeenByRender.push(message.locale);
      return { html: "<p>x</p>", subject: "x" };
    },
    send: async (_address: string, message: ChannelMessage) => {
      localesSeenBySend.push(message.locale);
      return { status: "sent" };
    } });
});

beforeAll(async () => {
  harness = await setupChatHarness(localeProbeFeature);
});

afterAll(async () => {
  await harness.cleanup();
});

function jobPayload(message: Record<string, unknown>): Record<string, unknown> {
  return {
    channelName: "locale-probe",
    tenantId: tenantAdmin.tenantId,
    recipientId: null,
    notificationType: "app:notify:locale",
    deliveryAttemptId: "00000000-0000-4000-8000-0000000000cc",
    priority: "normal",
    content: {
      address: "someone",
      message: { notificationType: "app:notify:locale", title: "X", ...message },
    },
  };
}

describe("delivery jobs carry the notification locale", () => {
  const runner = {
    async dispatch() {
      return "job-id";
    },
  };

  test("locale reaches the render and the send step of the one send job", async () => {
    localesSeenByRender.length = 0;
    localesSeenBySend.length = 0;

    await deliverySendJob(jobPayload({ locale: "de-AT" }), harness.buildJobContext(runner));

    expect(localesSeenByRender).toEqual(["de-AT"]);
    expect(localesSeenBySend).toEqual(["de-AT"]);
  });

  test("a payload queued without locale is still accepted", async () => {
    localesSeenByRender.length = 0;
    localesSeenBySend.length = 0;

    await deliverySendJob(jobPayload({}), harness.buildJobContext(runner));

    expect(localesSeenByRender).toEqual([undefined]);
    expect(localesSeenBySend).toEqual([undefined]);
  });
});
