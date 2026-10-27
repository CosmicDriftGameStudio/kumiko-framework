// The ingest-message payload built from a provider message. Shared by the supervisor's regular
// ingest, the header import of quarantined mails and the quarantine retry.

import type { NormalizedInboundMessage } from "./normalize-inbound-message.ts";
import type { MailAccountRecord } from "./types.ts";

export function ingestPayloadOf(
  account: MailAccountRecord,
  msg: NormalizedInboundMessage,
  options: {
    readonly providerCursor: string;
    readonly bodyRef: string;
    readonly contentUnavailableReason?: "quarantined";
  },
): Record<string, unknown> {
  return {
    accountId: account.id,
    ownerUserId: account.ownerUserId,
    providerName: account.provider,
    providerMessageId: msg.providerMessageId,
    messageIdHeader: msg.messageIdHeader,
    providerThreadId: msg.providerThreadId,
    references: msg.references,
    from: msg.from,
    to: msg.to,
    cc: msg.cc,
    subject: msg.subject,
    snippet: msg.snippet,
    receivedAtIso: msg.receivedAtIso,
    bodyRef: options.bodyRef,
    scope: msg.scope,
    providerCursor: options.providerCursor,
    bodyText: msg.bodyText,
    bodyTextTruncated: msg.bodyTextTruncated,
    ...(msg.rawMime != null && { rawMime: msg.rawMime }),
    ...(msg.bodyHtml !== null && { bodyHtml: msg.bodyHtml }),
    attachments: msg.attachments,
    skippedAttachments: msg.skippedAttachments,
    ...(msg.senderAuthentication !== undefined && {
      senderAuthentication: msg.senderAuthentication,
    }),
    ...(options.contentUnavailableReason !== undefined && {
      contentUnavailableReason: options.contentUnavailableReason,
    }),
  };
}
