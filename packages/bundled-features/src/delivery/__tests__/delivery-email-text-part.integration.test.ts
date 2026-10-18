// The text part must survive delivery.render → delivery.send: the send job
// payload is re-parsed by zod, which would drop a field the schema omits.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineFeature, templateVariable } from "@cosmicdrift/kumiko-framework/engine";
import {
  authMailRendererFeatures,
  seedAuthMailTemplates,
} from "../../auth-email-password/__tests__/auth-mail-stack.ts";
import { createEmailChannel } from "../../channel-email/email-channel.ts";
import { createInMemoryTransport } from "../../channel-email/types.ts";
import { DELIVERY_CHANNEL_EXTENSION, DeliveryJobs } from "../constants.ts";
import { deliveryRenderJob, deliverySendJob } from "../jobs.ts";
import { type ChatHarness, setupChatHarness, tenantAdmin } from "./chat-channel-harness.ts";

const transport = createInMemoryTransport();
const emailChannel = createEmailChannel({
  transport,
  resolveEmail: async () => null,
});

const NOTIFICATION_TYPE = "email-text-probe:notify:text-part";

const emailTextProbeFeature = defineFeature("email-text-probe", (r) => {
  r.requires({ features: ["delivery"] });
  r.notification("text-part", {
    variables: { actionUrl: templateVariable.link({ required: true }) },
    template: {
      en: { body: '<p>Welcome</p><p><a data-button href="{{actionUrl}}">Sign in</a></p>' },
    },
    meta: { en: { subject: "Welcome" } },
  });
  r.useExtension(DELIVERY_CHANNEL_EXTENSION, "email-text-probe", {
    mode: emailChannel.mode,
    render: emailChannel.render,
    send: emailChannel.send,
  });
});

let harness: ChatHarness;

beforeAll(async () => {
  harness = await setupChatHarness(...authMailRendererFeatures(), emailTextProbeFeature);
  await seedAuthMailTemplates(harness.stack);
});

afterAll(async () => {
  await harness.cleanup();
});

describe("delivery jobs carry the email text part", () => {
  test("the rendered mail's text part reaches the transport through both jobs", async () => {
    const dispatched: { name: string; payload: Record<string, unknown> }[] = [];
    const runner = {
      async dispatch(name: string, payload: Record<string, unknown>) {
        dispatched.push({ name, payload });
        return "job-id";
      },
    };
    const payload = {
      channelName: "email-text-probe",
      address: "user@example.com",
      tenantId: tenantAdmin.tenantId,
      recipientId: null,
      notificationType: NOTIFICATION_TYPE,
      deliveryAttemptId: "00000000-0000-4000-8000-0000000000dd",
      priority: "normal",
      message: {
        notificationType: NOTIFICATION_TYPE,
        title: "Welcome",
        locale: "en",
        data: { actionUrl: "https://app.test/login" },
      },
    };

    await deliveryRenderJob(payload, harness.buildJobContext(runner));
    const sendJob = dispatched[0];
    if (!sendJob) throw new Error("send job not dispatched");
    expect(sendJob.name).toBe(DeliveryJobs.send);

    await deliverySendJob(sendJob.payload, harness.buildJobContext(runner));

    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.text).toContain("https://app.test/login");
    expect(transport.sent[0]?.html).toContain('href="https://app.test/login"');
  });
});
