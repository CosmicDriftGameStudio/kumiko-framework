// Sends a mail from a connected mailbox through the customer's own mail server. A plain server
// function rather than a handler: the caller's own write handler owns access and agent exposure,
// and the message (recipients, body) never becomes a dispatcher payload of its own.
//
// There is no fallback to the platform sender: a mailbox that cannot send answers with a typed
// failure, so a reply never leaves under an address the recipient did not write to.

import type { HandlerContext, WriteResult } from "@cosmicdrift/kumiko-framework/engine";
import {
  failNotFound,
  InternalError,
  UnprocessableError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { type MailAccountRow, toMailAccountRecord } from "./account-record.ts";
import { InboundMailAccountStatuses } from "./constants.ts";
import { isVisibleToCaller } from "./handlers/scope-visibility.ts";
import { resolveOutboundAttachments } from "./outbound-attachments.ts";
import {
  isMailSendNotConfiguredError,
  isMailSendRejectedError,
  type OutboundAttachment,
  type OutboundMailMessage,
  type OutboundMailSent,
  outboundMailMessageSchema,
  type ProviderSentMail,
} from "./outbound-mail.ts";
import { type OutboundSendStatus, outboundMailSendsTable } from "./outbound-send-entities.ts";
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
  outcomeUnknown: {
    reason: "mail_send_outcome_unknown",
    i18nKey: "inboundMail.send.errors.outcomeUnknown",
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
  /** Bytes the caller already holds, for example a PDF rendered in the same `beforeTransaction`. They go out next to `message.attachmentFileIds`, share the count and size limit, and are not access-checked: the caller vouches for them. */
  readonly attachedBytes?: readonly OutboundAttachment[];
  /** Makes the send retry-safe: the same key never sends twice. Needs `ctx.db.outsideTransaction`. */
  readonly idempotencyKey?: string;
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

type OutboundSendRecord = {
  readonly id: string;
  readonly status: OutboundSendStatus;
  readonly messageIdHeader: string | null;
  readonly attachmentFileIds: readonly string[];
};

type SendRecordDb = NonNullable<SendMailFromAccountContext["db"]["outsideTransaction"]>;

type SendRecordKey = {
  readonly idempotencyKey: string;
  readonly accountId: string;
  readonly userId: string;
};

function fetchSendRecord(
  recordDb: SendRecordDb,
  key: SendRecordKey,
): Promise<OutboundSendRecord | undefined> {
  return recordDb.fetchOne<OutboundSendRecord>(outboundMailSendsTable, {
    idempotencyKey: key.idempotencyKey,
    accountId: key.accountId,
    userId: key.userId,
  });
}

// A "sending" record without a result means the send may or may not have gone out (crash, or a
// parallel call still running), so the key answers outcomeUnknown instead of sending a second copy.
function resultOfRecordedSend(record: OutboundSendRecord): WriteResult<OutboundMailSent> {
  if (record.status === "sent" && record.messageIdHeader !== null) {
    return {
      isSuccess: true,
      data: {
        messageIdHeader: record.messageIdHeader,
        attachmentFileIds: record.attachmentFileIds,
      },
    };
  }
  return sendFailure("outcomeUnknown");
}

// Returns the claim's id, or the recorded outcome when the key was used before.
async function claimSend(
  recordDb: SendRecordDb,
  key: SendRecordKey,
): Promise<{ readonly claimId: string } | { readonly recorded: OutboundSendRecord }> {
  const claimId = crypto.randomUUID();
  try {
    await recordDb.insertOne(outboundMailSendsTable, {
      id: claimId,
      idempotencyKey: key.idempotencyKey,
      accountId: key.accountId,
      userId: key.userId,
      status: "sending" satisfies OutboundSendStatus,
      claimedAt: Temporal.Now.instant().toString(),
    });
    return { claimId };
  } catch (err) {
    // A parallel call claimed the same key between the lookup and the insert.
    const recorded = await fetchSendRecord(recordDb, key);
    if (recorded) return { recorded };
    throw err;
  }
}

type KeyedRecording = { readonly recordDb: SendRecordDb; readonly idempotencyKey: string };

type SendClaim = { readonly recordDb: SendRecordDb; readonly claimId: string };

function keyedRecordingOf(
  ctx: SendMailFromAccountContext,
  idempotencyKey: string | undefined,
): KeyedRecording | undefined {
  const recordDb = ctx.db.outsideTransaction;
  if (idempotencyKey !== undefined && !recordDb) {
    throw new InternalError({
      message: "sendMailFromAccount: idempotencyKey needs ctx.db.outsideTransaction",
    });
  }
  return idempotencyKey !== undefined && recordDb ? { recordDb, idempotencyKey } : undefined;
}

async function earlierResultFor(
  recording: KeyedRecording | undefined,
  accountId: string,
  userId: string,
): Promise<WriteResult<OutboundMailSent> | undefined> {
  if (!recording) return undefined;
  const recorded = await fetchSendRecord(recording.recordDb, {
    idempotencyKey: recording.idempotencyKey,
    accountId,
    userId,
  });
  return recorded ? resultOfRecordedSend(recorded) : undefined;
}

async function claimKeyedSend(
  recording: KeyedRecording | undefined,
  accountId: string,
  userId: string,
): Promise<SendClaim | { readonly recorded: OutboundSendRecord } | undefined> {
  if (!recording) return undefined;
  const claim = await claimSend(recording.recordDb, {
    idempotencyKey: recording.idempotencyKey,
    accountId,
    userId,
  });
  return "recorded" in claim ? claim : { recordDb: recording.recordDb, claimId: claim.claimId };
}

async function markSendRecorded(
  claim: SendClaim,
  sent: Pick<OutboundMailSent, "messageIdHeader">,
  attachmentFileIds: readonly string[],
): Promise<void> {
  await claim.recordDb.updateMany(
    outboundMailSendsTable,
    {
      status: "sent" satisfies OutboundSendStatus,
      messageIdHeader: sent.messageIdHeader,
      attachmentFileIds,
      sentAt: Temporal.Now.instant().toString(),
    },
    { id: claim.claimId },
  );
}

function sentResult(
  sent: ProviderSentMail,
  attachmentFileIds: readonly string[],
): OutboundMailSent {
  return {
    messageIdHeader: sent.messageIdHeader,
    attachmentFileIds,
    ...(sent.rejectedRecipients && { rejectedRecipients: sent.rejectedRecipients }),
  };
}

async function failedSendResult(
  ctx: SendMailFromAccountContext,
  err: unknown,
  claim: SendClaim | undefined,
  accountId: string,
): Promise<WriteResult<never>> {
  const failure = sendFailureOf(err);
  // An unexpected error leaves the claim in place: the mail may have gone out.
  if (!failure) throw err;
  // A typed failure means the server did not take the mail, so the key is free for a retry.
  if (claim) await claim.recordDb.deleteMany(outboundMailSendsTable, { id: claim.claimId });
  ctx.obs.log.warn("mail send from account failed", {
    accountId,
    reason: MAIL_SEND_ERRORS[failure].reason,
  });
  return sendFailure(failure);
}

// Sends immediately and cannot be rolled back. Call it from a handler's `beforeTransaction`
// (its ctx fits here): in the handler body the request transaction would stay open for the whole
// SMTP/IMAP round trip, and a later rollback would not recall the mail. Pass the result on as the
// hook's data. Retry-safe only with an idempotencyKey: a repeat of a finished send returns its
// stored result, and after a crash the same key answers outcomeUnknown. Without a key a client
// retry after a failed handler sends a second copy.
export async function sendMailFromAccount(
  ctx: SendMailFromAccountContext,
  input: SendMailFromAccountInput,
): Promise<WriteResult<OutboundMailSent>> {
  const message = outboundMailMessageSchema.safeParse(input.message);
  if (!message.success) return sendFailure("invalidMessage");

  const recording = keyedRecordingOf(ctx, input.idempotencyKey);

  const row = await ctx.db.fetchOne<MailAccountRow>(mailAccountsProjectionTable, {
    id: input.accountId,
    tenantId: ctx.user.tenantId,
  });
  if (!row || !isSendableBy(row, ctx.user)) return failNotFound("mail-account", input.accountId);

  // Looked up only after the mailbox check, so a key recorded for a mailbox or user the caller
  // cannot use never answers.
  const earlier = await earlierResultFor(recording, row.id, ctx.user.id);
  if (earlier) return earlier;

  const account = await toMailAccountRecord(row, ctx.user.tenantId, `${HANDLER_NAME}:${row.id}`);
  const providerCtx: InboundMailContext = {
    registry: ctx.registry,
    ...(ctx.services.secrets && { secrets: ctx.services.secrets }),
    auditUserId: ctx.user.id,
  };
  const plugin = resolveInboundProviderForAccount(providerCtx, account, HANDLER_NAME);
  if (!plugin.send) return sendFailure("notConfigured");

  const attachmentFileIds = message.data.attachmentFileIds ?? [];
  const resolved = await resolveOutboundAttachments(ctx, attachmentFileIds, input.attachedBytes);
  if (!resolved.isSuccess) return sendFailure(resolved.failure);

  const claimed = await claimKeyedSend(recording, account.id, ctx.user.id);
  if (claimed && "recorded" in claimed) return resultOfRecordedSend(claimed.recorded);

  try {
    const sent = await plugin.send(providerCtx, account, message.data, resolved.attachments);
    if (claimed) await markSendRecorded(claimed, sent, resolved.fileIds);
    return { isSuccess: true, data: sentResult(sent, resolved.fileIds) };
  } catch (err) {
    return failedSendResult(ctx, err, claimed, account.id);
  }
}
