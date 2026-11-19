// The delivery.send job must hand the channel the same secrets context in its render step as in
// its send step, so a channel can resolve tenant credentials while rendering.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import type { SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";
import { DELIVERY_CHANNEL_EXTENSION } from "../constants.ts";
import { deliverySendJob } from "../jobs.ts";
import type { ChannelResult } from "../types.ts";
import { type ChatHarness, setupChatHarness, tenantAdmin } from "./chat-channel-harness.ts";

let harness: ChatHarness;
let secretsSeenByRender: SecretsContext | undefined;

const renderProbeFeature = defineFeature("render-probe", (r) => {
  r.requires({ features: ["delivery"] });
  r.applyExtension({
    name: DELIVERY_CHANNEL_EXTENSION,
    entity: "render-probe",
    mode: "queued",
    render: async (_message, ctx) => {
      secretsSeenByRender = ctx.secrets;
      return { html: "<p>x</p>", subject: "x" };
    },
    send: async (): Promise<ChannelResult> => ({ status: "sent" }),
  });
});

beforeAll(async () => {
  harness = await setupChatHarness(renderProbeFeature);
});

afterAll(async () => {
  await harness.cleanup();
});

describe("deliverySendJob render step", () => {
  test("passes ctx.secrets into the channel's render step", async () => {
    const dispatched: string[] = [];
    const runner = {
      async dispatch(name: string) {
        dispatched.push(name);
        return "job-id";
      },
    };

    await deliverySendJob(
      {
        channelName: "render-probe",
        tenantId: tenantAdmin.tenantId,
        recipientId: null,
        notificationType: "app:notify:render-secrets",
        deliveryAttemptId: "00000000-0000-4000-8000-0000000000bb",
        priority: "normal",
        content: {
          address: "someone",
          message: { notificationType: "app:notify:render-secrets", title: "X" },
        },
      },
      harness.buildJobContext(runner),
    );

    expect(secretsSeenByRender).toBe(harness.secrets);
    expect(dispatched).toEqual([]);
  });
});
