// delivery.render must hand the channel the same secrets context delivery.send
// gets, so a channel can resolve tenant credentials in its render step.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import type { SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";
import { DELIVERY_CHANNEL_EXTENSION, DeliveryJobs } from "../constants.js";
import { deliveryRenderJob } from "../jobs.js";
import { type ChatHarness, setupChatHarness, tenantAdmin } from "./chat-channel-harness.js";

let harness: ChatHarness;
let secretsSeenByRender: SecretsContext | undefined;

const renderProbeFeature = defineFeature("render-probe", (r) => {
  r.requires("delivery");
  r.useExtension(DELIVERY_CHANNEL_EXTENSION, "render-probe", {
    mode: "queued",
    render: async (_message, ctx) => {
      secretsSeenByRender = ctx.secrets;
      return { html: "<p>x</p>", subject: "x" };
    },
    send: async () => ({ status: "sent" }),
  });
});

beforeAll(async () => {
  harness = await setupChatHarness(renderProbeFeature);
});

afterAll(async () => {
  await harness.cleanup();
});

describe("deliveryRenderJob", () => {
  test("passes ctx.secrets into the channel's render step", async () => {
    const dispatched: string[] = [];
    const runner = {
      async dispatch(name: string) {
        dispatched.push(name);
        return "job-id";
      },
    };

    await deliveryRenderJob(
      {
        channelName: "render-probe",
        address: "someone",
        tenantId: tenantAdmin.tenantId,
        recipientId: null,
        notificationType: "app:notify:render-secrets",
        deliveryAttemptId: "00000000-0000-4000-8000-0000000000bb",
        priority: "normal",
        message: { notificationType: "app:notify:render-secrets", title: "X" },
      },
      harness.buildJobContext(runner),
    );

    expect(secretsSeenByRender).toBe(harness.secrets);
    expect(dispatched).toEqual([DeliveryJobs.send]);
  });
});
