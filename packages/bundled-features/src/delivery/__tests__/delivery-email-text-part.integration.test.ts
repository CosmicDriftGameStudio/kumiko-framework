// The text part must survive delivery.render → delivery.send: the send job
// payload is re-parsed by zod, which would drop a field the schema omits.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { createEmailChannel } from "../../channel-email/email-channel.js";
import { createInMemoryTransport } from "../../channel-email/types.js";
import { createSimpleRenderer } from "../../renderer-simple/simple-renderer.js";
import { DELIVERY_CHANNEL_EXTENSION, DeliveryJobs } from "../constants.js";
import { deliveryRenderJob, deliverySendJob } from "../jobs.js";
import { type ChatHarness, setupChatHarness, tenantAdmin } from "./chat-channel-harness.js";

const transport = createInMemoryTransport();
const emailChannel = createEmailChannel({
  transport,
  renderer: createSimpleRenderer(),
  resolveEmail: async () => null,
});

const emailTextProbeFeature = defineFeature("email-text-probe", (r) => {
  r.requires("delivery");
  r.useExtension(DELIVERY_CHANNEL_EXTENSION, "email-text-probe", {
    mode: emailChannel.mode,
    render: emailChannel.render,
    send: emailChannel.send,
  });
});

let harness: ChatHarness;

beforeAll(async () => {
  harness = await setupChatHarness(emailTextProbeFeature);
});

afterAll(async () => {
  await harness.cleanup();
});

describe("delivery jobs carry the email text part", () => {
  test("the simple renderer's text part reaches the transport through both jobs", async () => {
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
      notificationType: "app:notify:text-part",
      deliveryAttemptId: "00000000-0000-4000-8000-0000000000dd",
      priority: "normal",
      message: {
        notificationType: "app:notify:text-part",
        title: "Welcome",
        data: {
          subject: "Welcome",
          header: "Welcome",
          sections: [{ button: { label: "Sign in", url: "https://app.test/login" } }],
        },
      },
    };

    await deliveryRenderJob(payload, harness.buildJobContext(runner));
    const sendJob = dispatched[0];
    if (!sendJob) throw new Error("send job not dispatched");
    expect(sendJob.name).toBe(DeliveryJobs.send);

    await deliverySendJob(sendJob.payload, harness.buildJobContext(runner));

    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.text).toBe("Welcome\n\nSign in: https://app.test/login");
    expect(transport.sent[0]?.html).toContain('href="https://app.test/login"');
  });
});
