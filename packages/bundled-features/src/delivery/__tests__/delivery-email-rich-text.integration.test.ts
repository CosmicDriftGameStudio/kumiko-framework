// A richText variable reaches the sent mail as sanitized HTML; a text variable
// carrying the same markup stays escaped.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  defineFeature,
  defineWriteHandler,
  type NotifyFn,
  templateVariable,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import * as z from "zod";
import {
  authMailRendererFeatures,
  seedAuthMailTemplates,
} from "../../auth-email-password/__tests__/auth-mail-stack.js";
import { createEmailChannel } from "../../channel-email/email-channel.js";
import { createInMemoryTransport } from "../../channel-email/types.js";
import { createConfigFeature } from "../../config/feature.js";
import { configValuesTable } from "../../config/table.js";
import { TenantQueries } from "../../tenant/constants.js";
import { createTenantFeature } from "../../tenant/feature.js";
import { tenantMembershipsTable } from "../../tenant/membership-table.js";
import { tenantEntity } from "../../tenant/schema/tenant.js";
import { DELIVERY_CHANNEL_EXTENSION } from "../constants.js";
import { createDeliveryFeature } from "../feature.js";
import { createDeliveryTestContext } from "../testing.js";

const tenantAdmin = createTestUser({ roles: ["TenantAdmin"] });
const transport = createInMemoryTransport();
const emailChannel = createEmailChannel({
  transport,
  resolveEmail: async () => null,
});

const NOTIFICATION_TYPE = "email-rich-text-probe:notify:rich-note";

const richTextProbeFeature = defineFeature("email-rich-text-probe", (r) => {
  r.requires({ features: ["delivery"] });
  r.writeHandler(
    defineWriteHandler({
      name: "send-note",
      schema: z.object({ note: z.string(), plain: z.string() }),
      access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      handler: async (event, ctx) => {
        const notify = ctx.notify as NotifyFn;
        await notify(NOTIFICATION_TYPE, {
          route: { "email-rich-text-probe": "user@example.com" },
          data: event.payload,
          immediate: true,
        });
        return { isSuccess: true, data: {} };
      },
    }),
  );
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

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createDeliveryFeature(),
      ...authMailRendererFeatures(),
      richTextProbeFeature,
    ],
    jobs: { consumerLane: "worker" },
    extraContext: (deps) =>
      createDeliveryTestContext(deps, { tenantUserIdsQuery: TenantQueries.resolveUserIds }),
  });
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
  await unsafeCreateEntityTable(stack.db, tenantEntity, "tenant");
  await seedAuthMailTemplates(stack);
});

afterAll(async () => {
  await stack.cleanup();
});

async function sendNote(data: { note: string; plain: string }) {
  const res = await stack.http.write("email-rich-text-probe:write:send-note", data, tenantAdmin);
  expect(res.status).toBe(200);
  const sent = transport.sent.at(-1);
  if (!sent) throw new Error("mail not sent");
  return sent.html ?? "";
}

describe("richText variable in a sent notification", () => {
  test("formatting and links survive, a text variable with markup stays escaped", async () => {
    const html = await sendNote({
      note: '<p><strong>fett</strong> <em>kursiv</em></p><ul><li>eins</li></ul><p><a href="https://example.com/doc">Doc</a></p>',
      plain: "<b>not bold</b>",
    });
    expect(html).toContain("<strong>fett</strong>");
    expect(html).toContain("<em>kursiv</em>");
    expect(html).toContain("<li><p>eins</p></li>");
    expect(html).toContain('href="https://example.com/doc"');
    expect(html).toContain("&lt;b&gt;not bold&lt;/b&gt;");
    expect(html).not.toContain("<b>not bold</b>");
  });

  test("script, event handlers and javascript links never reach the mail as live markup", async () => {
    const html = await sendNote({
      note: '<p onclick="steal()">hi</p><script>steal()</script><a href="javascript:steal()">x</a>',
      plain: "ok",
    });
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<p onclick");
    expect(html).not.toContain('href="javascript:');
  });
});
