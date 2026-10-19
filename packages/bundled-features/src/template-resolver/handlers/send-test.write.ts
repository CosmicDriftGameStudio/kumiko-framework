import { defineWriteHandler, type Registry } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import {
  collectChannels,
  createEmailAttachmentReader,
  EMAIL_CHANNEL_NAME,
} from "../../delivery/index.ts";
import { fileContextForTenant } from "../../file-foundation/index.ts";
import { TEST_MAIL_SUBJECT_PREFIX } from "../constants.ts";
import { TemplateResolverErrors } from "../qualified-names.ts";
import { renderTemplatePreview } from "../template-preview.ts";
import { localeSchema, templateSlugSchema } from "./shared.ts";

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

function errorCodeOf(error: unknown): string | undefined {
  const code = error instanceof Error ? Reflect.get(error, "code") : undefined;
  return typeof code === "string" ? code : undefined;
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
    variables: z.record(z.string(), z.unknown()).optional(),
    includeAttachments: z.boolean().default(true),
    prefixSubject: z.boolean().default(true),
  }),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  rateLimit: { per: "user+handler", ...TEST_MAIL_RATE_LIMIT },
  description:
    "Sends the rendered preview of a mail template draft, or of the stored template when no content is given, to the calling user's own address with the subject prefixed by [TEST] unless prefixSubject is false, carrying the inline images and, unless includeAttachments is false, the files attached to the template; there is no recipient input, the sample values come from the declared variable examples unless variables replaces them (checked against the variable schema), and a draft that fails the write rules is rejected without sending.",
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
      config: ctx.config,
      readAttachment: createEmailAttachmentReader(
        ctx.db,
        ctx.registry,
        event.user.tenantId,
        ctx.config,
        (tenantId) => fileContextForTenant(ctx, ctx.user.tenantId, tenantId),
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
    let sentStatus: string;
    try {
      const result = await channel.send(
        address,
        {
          // The template slug is the notification name, so the test mail takes the transport the real mail takes.
          notificationType: event.payload.slug,
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
      sentStatus = result.status;
    } catch (error) {
      // Class and code only: the message can carry the address or a provider response body.
      ctx.log?.warn("template test mail: channel threw", {
        tenantId: event.user.tenantId,
        errorClass: error instanceof Error ? error.name : typeof error,
        errorCode: errorCodeOf(error),
      });
      return testMailFailed("channel_error");
    }
    if (sentStatus !== "sent") {
      ctx.log?.warn("template test mail: channel did not send", {
        tenantId: event.user.tenantId,
        status: sentStatus,
      });
      return testMailFailed("not_sent");
    }
    return { isSuccess: true as const, data: { subject, checks: preview.checks } };
  },
});
