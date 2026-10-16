// A richText variable reaches the sent mail as sanitized HTML; a text variable
// carrying the same markup stays escaped.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineFeature, templateVariable } from "@cosmicdrift/kumiko-framework/engine";
import {
  authMailRendererFeatures,
  seedAuthMailTemplates,
} from "../../auth-email-password/__tests__/auth-mail-stack.js";
import { createEmailChannel } from "../../channel-email/email-channel.js";
import { createInMemoryTransport } from "../../channel-email/types.js";
import { DELIVERY_CHANNEL_EXTENSION, DeliveryJobs } from "../constants.js";
import { deliveryRenderJob, deliverySendJob } from "../jobs.js";
import { type ChatHarness, setupChatHarness, tenantAdmin } from "./chat-channel-harness.js";

const transport = createInMemoryTransport();
const emailChannel = createEmailChannel({
  transport,
  resolveEmail: async () => null,
});

const NOTIFICATION_TYPE = "email-rich-text-probe:notify:rich-note";

const richTextProbeFeature = defineFeature("email-rich-text-probe", (r) => {
  r.requires("delivery");
  r.notification("rich-note", {
    variables: {
      note: templateVariable.richText({ required: true }),
      plain: templateVariable.text({ required: true }),
    },
    template: {
      en: {
        body: '<p><span data-variable="note"></span></p><p>Plain: <span data-variable="plain"></span></p>',
      },
    },
    meta: { en: { subject: "Note" } },
  });
  r.useExtension(DELIVERY_CHANNEL_EXTENSION, "email-rich-text-probe", {
    mode: emailChannel.mode,
    render: emailChannel.render,
    send: emailChannel.send,
  });
});

let harness: ChatHarness;

beforeAll(async () => {
  harness = await setupChatHarness(...authMailRendererFeatures(), richTextProbeFeature);
  await seedAuthMailTemplates(harness.stack);
});

afterAll(async () => {
  await harness.cleanup();
});

async function sendNote(data: { note: string; plain: string }, attemptSuffix: string) {
  const dispatched: { name: string; payload: Record<string, unknown> }[] = [];
  const runner = {
    async dispatch(name: string, payload: Record<string, unknown>) {
      dispatched.push({ name, payload });
      return "job-id";
    },
  };
  const payload = {
    channelName: "email-rich-text-probe",
    address: "user@example.com",
    tenantId: tenantAdmin.tenantId,
    recipientId: null,
    notificationType: NOTIFICATION_TYPE,
    deliveryAttemptId: `00000000-0000-4000-8000-0000000000${attemptSuffix}`,
    priority: "normal",
    message: { notificationType: NOTIFICATION_TYPE, title: "Note", locale: "en", data },
  };
  await deliveryRenderJob(payload, harness.buildJobContext(runner));
  const sendJob = dispatched[0];
  if (!sendJob) throw new Error("send job not dispatched");
  expect(sendJob.name).toBe(DeliveryJobs.send);
  await deliverySendJob(sendJob.payload, harness.buildJobContext(runner));
  const sent = transport.sent.at(-1);
  if (!sent) throw new Error("mail not sent");
  return sent.html ?? "";
}

describe("richText variable in a sent notification", () => {
  test("formatting and links survive, a text variable with markup stays escaped", async () => {
    const html = await sendNote(
      {
        note: '<p><strong>fett</strong> <em>kursiv</em></p><ul><li>eins</li></ul><p><a href="https://example.com/doc">Doc</a></p>',
        plain: "<b>not bold</b>",
      },
      "e1",
    );
    expect(html).toContain("<strong>fett</strong>");
    expect(html).toContain("<em>kursiv</em>");
    expect(html).toContain("<li><p>eins</p></li>");
    expect(html).toContain('href="https://example.com/doc"');
    expect(html).toContain("&lt;b&gt;not bold&lt;/b&gt;");
    expect(html).not.toContain("<b>not bold</b>");
  });

  test("script, event handlers and javascript links never reach the mail as live markup", async () => {
    const html = await sendNote(
      {
        note: '<p onclick="steal()">hi</p><script>steal()</script><a href="javascript:steal()">x</a>',
        plain: "ok",
      },
      "e2",
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<p onclick");
    expect(html).not.toContain('href="javascript:');
  });
});
