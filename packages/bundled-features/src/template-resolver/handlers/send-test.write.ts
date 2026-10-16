import { defineWriteHandler, type Registry } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import {
  collectChannels,
  createEmailAttachmentReader,
  EMAIL_CHANNEL_NAME,
} from "../../delivery/index.js";
import { fileContextForTenant } from "../../file-foundation/index.js";
import { TEST_MAIL_NOTIFICATION_TYPE, TEST_MAIL_SUBJECT_PREFIX } from "../constants.js";
import { TemplateResolverErrors } from "../qualified-names.js";
import { renderTemplatePreview } from "../template-preview.js";
import { localeSchema, templateSlugSchema } from "./shared.js";

const TEST_MAIL_RATE_LIMIT = { limit: 10, windowSeconds: 3600 } as const;

function emailChannelOf(registry: Registry) {
  return collectChannels(registry).find((channel) => channel.name === EMAIL_CHANNEL_NAME);
}

// Transport errors can carry provider responses or the address, so the client only gets a fixed code.
function testMailFailed(code: "channel_error" | "not_sent") {
  return writeFailure(
    new UnprocessableError(TemplateResolverErrors.testMailFailed, {
      i18nKey: "templateResolver.errors.testMail.failed",
      details: { code },
    }),
  );
}

// The only recipient is the caller's own address, resolved server-side, so the handler can never mail a third party.
export const sendTestWrite = defineWriteHandler({
  name: "send-test",
  schema: z.object({
    slug: templateSlugSchema,
    locale: localeSchema,
    content: z.string().max(200_000).optional(),
    meta: z.unknown().optional(),
    variableSchema: z.record(z.string(), z.unknown()).default({}),
    includeAttachments: z.boolean().default(true),
    prefixSubject: z.boolean().default(true),
  }),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  rateLimit: { per: "user+handler", ...TEST_MAIL_RATE_LIMIT },
  description:
    "Sends the rendered preview of a mail template draft, or of the stored template when no content is given, to the calling user's own address with the subject prefixed by [TEST] unless prefixSubject is false, carrying the inline images and, unless includeAttachments is false, the files attached to the template; there is no recipient input, the sample values come from the declared variable examples, and a draft that fails the write rules is rejected without sending.",
  handler: async (event, ctx) => {
    const { includeAttachments, prefixSubject, ...previewPayload } = event.payload;
    const outcome = await renderTemplatePreview(ctx, event.user, {
      ...previewPayload,
      kind: "mail",
    });
    if (!outcome.ok) return writeFailure(outcome.error);
    const { preview, sender } = outcome;
    const mailAttachments = includeAttachments
      ? outcome.mailAttachments
      : outcome.mailAttachments.filter((ref) => ref.kind === "inline");

    const channel = emailChannelOf(ctx.registry);
    if (channel === undefined) {
      return writeFailure(
        new UnprocessableError(TemplateResolverErrors.testMailNoChannel, {
          i18nKey: "templateResolver.errors.testMail.noChannel",
        }),
      );
    }
    const channelContext = {
      db: ctx.db,
      registry: ctx.registry,
      sseBroker: undefined,
      tenantId: event.user.tenantId,
      secrets: ctx.secrets,
      readAttachment: createEmailAttachmentReader(
        ctx.db,
        ctx.registry,
        event.user.tenantId,
        ctx.config,
        (tenantId) => fileContextForTenant(ctx, tenantId),
      ),
    };
    const address = (await channel.resolve?.(event.user.id, channelContext)) ?? null;
    if (address === null) {
      return writeFailure(
        new UnprocessableError(TemplateResolverErrors.testMailNoAddress, {
          i18nKey: "templateResolver.errors.testMail.noAddress",
        }),
      );
    }

    const subject = `${prefixSubject ? TEST_MAIL_SUBJECT_PREFIX : ""}${preview.subject ?? ""}`;
    let sent: boolean;
    try {
      const result = await channel.send(
        address,
        {
          notificationType: TEST_MAIL_NOTIFICATION_TYPE,
          title: subject,
          body: undefined,
          data: undefined,
          locale: event.payload.locale,
        },
        channelContext,
        {
          subject,
          html: preview.html,
          text: preview.text ?? "",
          ...sender,
          attachments: mailAttachments,
        },
      );
      sent = result.status === "sent";
    } catch {
      return testMailFailed("channel_error");
    }
    if (!sent) return testMailFailed("not_sent");
    return { isSuccess: true as const, data: { subject, checks: preview.checks } };
  },
});
