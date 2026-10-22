// The text part and the template's sender defaults must survive delivery.render → delivery.send:
// the send job payload is re-parsed by zod, which would drop a field the schema omits.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineFeature, templateVariable } from "@cosmicdrift/kumiko-framework/engine";
import {
  authMailRendererFeatures,
  seedAuthMailTemplates,
} from "../../auth-email-password/__tests__/auth-mail-stack.ts";
import { createEmailChannel } from "../../channel-email/email-channel.ts";
import { createInMemoryTransport } from "../../channel-email/types.ts";
import { seedSystemTemplate } from "../../template-resolver/seeding.ts";
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
  r.notification("sender-defaults", {
    template: { en: { body: "<p>Hello</p>" } },
    meta: { en: { subject: "Hello" } },
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
  // Code-declared notification meta has no sender fields; they come from the stored template.
  await seedSystemTemplate(harness.stack.db, {
    slug: "email-text-probe:notify:sender-defaults",
    kind: "mail",
    locale: "en",
    content: "<p>Hello</p>",
    contentFormat: "html",
    meta: {
      subject: "Hello",
      senderName: "Nordlicht Immobilien GmbH",
      replyTo: "buchhaltung@nordlicht-immobilien.de",
    },
    ifExists: "update",
  });
});

afterAll(async () => {
  await harness.cleanup();
});

async function deliverThroughBothJobs(
  notificationType: string,
  data: Record<string, unknown>,
): Promise<void> {
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
    notificationType,
    deliveryAttemptId: "00000000-0000-4000-8000-0000000000dd",
    priority: "normal",
    message: { notificationType, title: "Welcome", locale: "en", data },
  };

  await deliveryRenderJob(payload, harness.buildJobContext(runner));
  const sendJob = dispatched[0];
  if (!sendJob) throw new Error("send job not dispatched");
  expect(sendJob.name).toBe(DeliveryJobs.send);

  await deliverySendJob(sendJob.payload, harness.buildJobContext(runner));
}

describe("delivery jobs carry the email text part", () => {
  test("the rendered mail's text part reaches the transport through both jobs", async () => {
    transport.sent.length = 0;

    await deliverThroughBothJobs(NOTIFICATION_TYPE, { actionUrl: "https://app.test/login" });

    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.text).toContain("https://app.test/login");
    expect(transport.sent[0]?.html).toContain('href="https://app.test/login"');
  });
});

describe("delivery jobs carry the template's sender defaults", () => {
  const SENDER_DEFAULTS_TYPE = "email-text-probe:notify:sender-defaults";

  test("the template's sender name and reply-to reach the transport through both jobs", async () => {
    transport.sent.length = 0;

    await deliverThroughBothJobs(SENDER_DEFAULTS_TYPE, {});

    expect(transport.sent[0]).toMatchObject({
      fromName: "Nordlicht Immobilien GmbH",
      replyTo: "buchhaltung@nordlicht-immobilien.de",
    });
  });

  test("a reply-to from the notify data wins over the template default", async () => {
    transport.sent.length = 0;

    await deliverThroughBothJobs(SENDER_DEFAULTS_TYPE, { replyTo: "support@example.com" });

    expect(transport.sent[0]).toMatchObject({
      fromName: "Nordlicht Immobilien GmbH",
      replyTo: "support@example.com",
    });
  });
});
