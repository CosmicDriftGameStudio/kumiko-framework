// Sends a mail from a connected mailbox through the customer's own mail server. A plain server
// function rather than a handler: the caller's own write handler owns access and agent exposure,
// and the message (recipients, body) never becomes a dispatcher payload of its own.
//
// There is no fallback to the platform sender: a mailbox that cannot send answers with a typed
// failure, so a reply never leaves under an address the recipient did not write to.

import type { HandlerContext, WriteResult } from "@cosmicdrift/kumiko-framework/engine";
import {
  failNotFound,
  UnprocessableError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { type MailAccountRow, toMailAccountRecord } from "./account-record.ts";
import { InboundMailAccountStatuses } from "./constants.ts";
import { isVisibleToCaller } from "./handlers/scope-visibility.ts";
import { resolveOutboundAttachments } from "./outbound-attachments.ts";
import {
  isMailSendNotConfiguredError,
  isMailSendRejectedError,
  type OutboundMailMessage,
  type OutboundMailSent,
  outboundMailMessageSchema,
} from "./outbound-mail.ts";
import { mailAccountsProjectionTable } from "./projection.ts";
import {
  isInboundAuthError,
  isInboundRateLimitError,
  isInboundTransientError,
} from "./provider-errors.ts";
import { resolveInboundProviderForAccount } from "./provider-factory.ts";
import type { InboundMailContext } from "./types.ts";

export const MAIL_SEND_ERRORS = {
  notConfigured: {
    reason: "mail_send_not_configured",
    i18nKey: "inboundMail.send.errors.notConfigured",
  },
  loginRejected: {
    reason: "mail_send_login_rejected",
    i18nKey: "inboundMail.send.errors.loginRejected",
  },
  serverUnreachable: {
    reason: "mail_send_server_unreachable",
    i18nKey: "inboundMail.send.errors.serverUnreachable",
  },
  rejected: { reason: "mail_send_rejected", i18nKey: "inboundMail.send.errors.rejected" },
  invalidMessage: {
    reason: "mail_send_invalid_message",
    i18nKey: "inboundMail.send.errors.invalidMessage",
  },
  attachmentInvalid: {
    reason: "mail_send_attachment_invalid",
    i18nKey: "inboundMail.send.errors.attachmentInvalid",
  },
  attachmentsTooLarge: {
    reason: "mail_send_attachments_too_large",
    i18nKey: "inboundMail.send.errors.attachmentsTooLarge",
  },
} as const;
export type MailSendFailure = keyof typeof MAIL_SEND_ERRORS;

// Query-only dispatch: attachment reads run as the caller, and a send path must not be able to
// write through the caller's rights.
export type SendMailFromAccountContext = Pick<
  HandlerContext,
  "db" | "registry" | "user" | "services" | "obs"
> & { readonly dispatch: Pick<HandlerContext["dispatch"], "query"> };

export type SendMailFromAccountInput = {
  readonly accountId: string;
  readonly message: OutboundMailMessage;
};

const HANDLER_NAME = "inbound-mail-foundation:send-from-account";

function sendFailure(failure: MailSendFailure): WriteResult<never> {
  const { reason, i18nKey } = MAIL_SEND_ERRORS[failure];
  return writeFailure(new UnprocessableError(reason, { i18nKey }));
}

function sendFailureOf(err: unknown): MailSendFailure | undefined {
  if (isMailSendNotConfiguredError(err)) return "notConfigured";
  if (isInboundAuthError(err)) return "loginRejected";
  if (isInboundTransientError(err) || isInboundRateLimitError(err)) return "serverUnreachable";
  if (isMailSendRejectedError(err)) return "rejected";
  return undefined;
}

// A disconnected mailbox and someone else's personal mailbox are reported as missing, so the
// caller cannot tell them apart from an id that never existed.
function isSendableBy(row: MailAccountRow, user: SendMailFromAccountContext["user"]): boolean {
  return row.status !== InboundMailAccountStatuses.disconnected && isVisibleToCaller(row, user);
}

export async function sendMailFromAccount(
  ctx: SendMailFromAccountContext,
  input: SendMailFromAccountInput,
): Promise<WriteResult<OutboundMailSent>> {
  const message = outboundMailMessageSchema.safeParse(input.message);
  if (!message.success) return sendFailure("invalidMessage");

  const row = await ctx.db.fetchOne<MailAccountRow>(mailAccountsProjectionTable, {
    id: input.accountId,
    tenantId: ctx.user.tenantId,
  });
  if (!row || !isSendableBy(row, ctx.user)) return failNotFound("mail-account", input.accountId);

  const account = await toMailAccountRecord(row, ctx.user.tenantId, `${HANDLER_NAME}:${row.id}`);
  const providerCtx: InboundMailContext = {
    registry: ctx.registry,
    ...(ctx.services.secrets && { secrets: ctx.services.secrets }),
    auditUserId: ctx.user.id,
  };
  const plugin = resolveInboundProviderForAccount(providerCtx, account, HANDLER_NAME);
  if (!plugin.send) return sendFailure("notConfigured");

  const attachmentFileIds = message.data.attachmentFileIds ?? [];
  const resolved = await resolveOutboundAttachments(ctx, attachmentFileIds);
  if (!resolved.isSuccess) return sendFailure(resolved.failure);

  try {
    const sent = await plugin.send(providerCtx, account, message.data, resolved.attachments);
    return {
      isSuccess: true,
      data: { messageIdHeader: sent.messageIdHeader, attachmentFileIds: resolved.fileIds },
    };
  } catch (err) {
    const failure = sendFailureOf(err);
    if (!failure) throw err;
    ctx.obs.log.warn("mail send from account failed", {
      accountId: account.id,
      reason: MAIL_SEND_ERRORS[failure].reason,
    });
    return sendFailure(failure);
  }
}
