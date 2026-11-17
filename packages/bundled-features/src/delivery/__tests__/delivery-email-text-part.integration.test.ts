// The text part and the template's sender defaults must reach the transport through the
// delivery.send job, which renders and sends in one step.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineFeature, templateVariable } from "@cosmicdrift/kumiko-framework/engine";
import {
  authMailRendererFeatures,
  seedAuthMailTemplates,
} from "../../auth-email-password/__tests__/auth-mail-stack.ts";
import { createEmailChannel } from "../../channel-email/email-channel.ts";
import { createInMemoryTransport } from "../../channel-email/types.ts";
import { seedSystemTemplate } from "../../template-resolver/seeding.ts";
import { DELIVERY_CHANNEL_EXTENSION } from "../constants.ts";
import { deliverySendJob } from "../jobs.ts";
import { type ChatHarness, setupChatHarness, tenantAdmin } from "./chat-channel-harness.ts";

const transport = createInMemoryTransport();
const emailChannel = createEmailChannel({
  transport,
  resolveEmail: async () => null,
});

const NOTIFICATION_TYPE = "email-text-probe:notify:text-part";

const emailTextProbeFeature = defineFeature("email-text-probe", (r) => {
  r.requires({ features: ["delivery"] });
  r.notification({ name: "text-part", variables: { actionUrl: templateVariable.link({ required: true }) },
    template: {
      en: { body: '<p>Welcome</p><p><a data-button href="{{actionUrl}}">Sign in</a></p>' },
    },
    meta: { en: { subject: "Welcome" } } });
  r.notification({ name: "sender-defaults", template: { en: { body: "<p>Hello</p>" } },
    meta: { en: { subject: "Hello" } } });
  r.applyExtension({ name: DELIVERY_CHANNEL_EXTENSION, entity: "email-text-probe", mode: emailChannel.mode,
    render: emailChannel.render,
    send: emailChannel.send });
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

async function deliverThroughSendJob(
  notificationType: string,
  data: Record<string, unknown>,
): Promise<void> {
  const runner = {
    async dispatch() {
      return "job-id";
    },
  };
  await deliverySendJob(
    {
      channelName: "email-text-probe",
      tenantId: tenantAdmin.tenantId,
      recipientId: null,
      notificationType,
      deliveryAttemptId: "00000000-0000-4000-8000-0000000000dd",
      priority: "normal",
      content: {
        address: "user@example.com",
        message: { notificationType, title: "Welcome", locale: "en", data },
      },
    },
    harness.buildJobContext(runner),
  );
}

describe("delivery jobs carry the email text part", () => {
  test("the rendered mail's text part reaches the transport through the send job", async () => {
    transport.sent.length = 0;

    await deliverThroughSendJob(NOTIFICATION_TYPE, { actionUrl: "https://app.test/login" });

    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.text).toContain("https://app.test/login");
    expect(transport.sent[0]?.html).toContain('href="https://app.test/login"');
  });
});

describe("delivery jobs carry the template's sender defaults", () => {
  const SENDER_DEFAULTS_TYPE = "email-text-probe:notify:sender-defaults";

  test("the template's sender name and reply-to reach the transport through the send job", async () => {
    transport.sent.length = 0;

    await deliverThroughSendJob(SENDER_DEFAULTS_TYPE, {});

    expect(transport.sent[0]).toMatchObject({
      fromName: "Nordlicht Immobilien GmbH",
      replyTo: "buchhaltung@nordlicht-immobilien.de",
    });
  });

  test("a reply-to from the notify data wins over the template default", async () => {
    transport.sent.length = 0;

    await deliverThroughSendJob(SENDER_DEFAULTS_TYPE, { replyTo: "support@example.com" });

    expect(transport.sent[0]).toMatchObject({
      fromName: "Nordlicht Immobilien GmbH",
      replyTo: "support@example.com",
    });
  });
});
