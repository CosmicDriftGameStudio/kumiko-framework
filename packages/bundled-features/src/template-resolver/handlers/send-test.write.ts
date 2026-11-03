import {
  type DeliveryErrorCode,
  defineWriteHandler,
  type NotifyDeliveryStatus,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  InternalError,
  UnprocessableError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { type ChannelResult, EMAIL_CHANNEL_NAME } from "../../delivery/index.ts";
import { unprocessable } from "../../shared/index.ts";
import {
  refuseTemplateEdit,
  type TemplateEditPolicy,
  templateEditAccess,
} from "../template-edit-policy.ts";
import { renderTemplatePreview } from "../template-preview.ts";
import { TEST_MAIL_NOTIFICATION_TYPE, TEST_MAIL_SUBJECT_PREFIX } from "../web/constants.ts";
import { TemplateResolverErrors } from "../web/qualified-names.ts";
import {
  emailChannelOf,
  resolveTestMailAddress,
  testMailChannelContext,
} from "./send-test-shared.ts";
import { localeSchema, templateSlugSchema } from "./shared.ts";

const TEST_MAIL_RATE_LIMIT = { limit: 10, windowSeconds: 3600 } as const;

// Transport errors can carry provider responses or the address, so the client only gets a fixed code.
function testMailFailed(code: "channel_error" | "not_sent") {
  return unprocessable(
    TemplateResolverErrors.testMailFailed,
    "templateResolver.errors.testMail.failed",
    { code },
  );
}

function errorCodeOf(error: unknown): string | undefined {
  const code = error instanceof Error ? Reflect.get(error, "code") : undefined;
  return typeof code === "string" ? code : undefined;
}

// The only recipient is the caller's own address, resolved server-side, so the handler can never mail a third party.
export function makeSendTestWrite(policy: TemplateEditPolicy) {
  return defineWriteHandler({
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
    access: templateEditAccess(policy.tenantEditable),
    rateLimit: { per: "user+handler", ...TEST_MAIL_RATE_LIMIT },
    description:
      "Sends the rendered preview of a mail template draft, or of the stored template when no content is given, to the calling user's own address with the subject prefixed by [TEST] unless prefixSubject is false, carrying the inline images and, unless includeAttachments is false, the files attached to the template; there is no recipient input, the sample values come from the declared variable examples unless variables replaces them (checked against the variable schema), and a draft that fails the write rules is rejected without sending.",
    handler: async (event, ctx) => {
      // Sending a test is part of editing, so it follows the same edit policy as the editor writes.
      const refused = refuseTemplateEdit(policy, event.user, {
        slug: event.payload.slug,
        kind: "mail",
      });
      if (refused !== null) return refused;
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
      // Fail closed before sending: a test mail must never leave without its attempt row.
      const logOwnDeliveryAttempt = ctx.services._logOwnDeliveryAttempt;
      if (logOwnDeliveryAttempt === undefined) {
        throw new InternalError({
          message:
            "template test mail: no delivery attempt log wired; the delivery boot context (createDeliveryTestContext in tests) sets _deliveryAttemptLogFactory",
        });
      }
      const channelContext = testMailChannelContext(ctx, event.user);
      const address = await resolveTestMailAddress(channel, channelContext, event.user);
      if (address === null) {
        return writeFailure(
          new UnprocessableError(TemplateResolverErrors.testMailNoAddress, {
            i18nKey: "templateResolver.errors.testMail.noAddress",
          }),
        );
      }

      const subject = `${prefixSubject ? TEST_MAIL_SUBJECT_PREFIX : ""}${preview.subject ?? ""}`;
      // Delivery logs on its own connection, so a failed send stays logged although this handler's transaction rolls back.
      const logTestMail = (status: NotifyDeliveryStatus, error: DeliveryErrorCode | null) =>
        logOwnDeliveryAttempt({
          notificationType: TEST_MAIL_NOTIFICATION_TYPE,
          channel: EMAIL_CHANNEL_NAME,
          recipientAddress: address,
          status,
          error,
          priority: "normal",
        });
      let result: ChannelResult;
      try {
        result = await channel.send(
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
      } catch (error) {
        // Class and code only: the message can carry the address or a provider response body.
        ctx.obs.log?.warn("template test mail: channel threw", {
          tenantId: event.user.tenantId,
          errorClass: error instanceof Error ? error.name : typeof error,
          errorCode: errorCodeOf(error),
        });
        await logTestMail("failed", "channel_error");
        return testMailFailed("channel_error");
      }
      if (result.status !== "sent") {
        ctx.obs.log?.warn("template test mail: channel did not send", {
          tenantId: event.user.tenantId,
          status: result.status,
        });
        await logTestMail(result.status, result.error ?? "send_failed");
        return testMailFailed("not_sent");
      }
      await logTestMail("sent", null);
      return { isSuccess: true as const, data: { subject, checks: preview.checks } };
    },
  });
}
