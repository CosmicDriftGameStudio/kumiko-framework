// The notification locale must survive delivery.render → delivery.send, and
// jobs queued before the locale field existed must still be accepted.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { DELIVERY_CHANNEL_EXTENSION, DeliveryJobs } from "../constants.js";
import { deliveryRenderJob, deliverySendJob } from "../jobs.js";
import type { ChannelMessage } from "../types.js";
import { type ChatHarness, setupChatHarness, tenantAdmin } from "./chat-channel-harness.js";

let harness: ChatHarness;
const localesSeenByRender: (string | undefined)[] = [];
const localesSeenBySend: (string | undefined)[] = [];

const localeProbeFeature = defineFeature("locale-probe", (r) => {
  r.requires("delivery");
  r.useExtension(DELIVERY_CHANNEL_EXTENSION, "locale-probe", {
    mode: "queued",
    render: async (message: ChannelMessage) => {
      localesSeenByRender.push(message.locale);
      return { html: "<p>x</p>", subject: "x" };
    },
    send: async (_address: string, message: ChannelMessage) => {
      localesSeenBySend.push(message.locale);
      return { status: "sent" };
    },
  });
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
    address: "someone",
    tenantId: tenantAdmin.tenantId,
    recipientId: null,
    notificationType: "app:notify:locale",
    deliveryAttemptId: "00000000-0000-4000-8000-0000000000cc",
    priority: "normal",
    message: { notificationType: "app:notify:locale", title: "X", ...message },
  };
}

describe("delivery jobs carry the notification locale", () => {
  test("locale reaches render and is forwarded to the send job payload", async () => {
    const dispatched: { name: string; payload: Record<string, unknown> }[] = [];
    const runner = {
      async dispatch(name: string, payload: Record<string, unknown>) {
        dispatched.push({ name, payload });
        return "job-id";
      },
    };

    await deliveryRenderJob(jobPayload({ locale: "de-AT" }), harness.buildJobContext(runner));
    const sendJob = dispatched[0];
    if (!sendJob) throw new Error("send job not dispatched");
    expect(sendJob.name).toBe(DeliveryJobs.send);

    await deliverySendJob(sendJob.payload, harness.buildJobContext(runner));

    expect(localesSeenByRender).toEqual(["de-AT"]);
    expect(localesSeenBySend).toEqual(["de-AT"]);
  });

  test("a payload queued without locale is still accepted", async () => {
    localesSeenByRender.length = 0;
    localesSeenBySend.length = 0;
    const runner = {
      async dispatch() {
        return "job-id";
      },
    };

    await deliveryRenderJob(jobPayload({}), harness.buildJobContext(runner));
    await deliverySendJob(jobPayload({}), harness.buildJobContext(runner));

    expect(localesSeenByRender).toEqual([undefined]);
    expect(localesSeenBySend).toEqual([undefined]);
  });
});
