// send for the imap provider: SMTP with the mailbox's own login, From = the mailbox address.
// The MIME is built once, so the copy in the sent folder is byte for byte what went out.

import { sanitizeMailDisplayName } from "@cosmicdrift/kumiko-bundled-features/foundation-shared";
import {
  InboundAuthError,
  type InboundMailContext,
  InboundTransientError,
  isInboundAuthError,
  type MailAccountRecord,
  MailSendNotConfiguredError,
  MailSendRejectedError,
  type OutboundAttachment,
  type OutboundMailMessage,
  type ProviderSentMail,
} from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
import MailComposer from "nodemailer/lib/mail-composer";
import { FEATURE_NAME } from "./constants.ts";
import { type ImapCredentialDocument, readCredentialDocument } from "./credential-document.ts";
import { appendToSentFolder } from "./sent-folder.ts";
import { SmtpFailureError, sendRawViaSmtp } from "./smtp-client.ts";

// A host the guard blocks stays blocked and a failed certificate check stays failed: retrying
// cannot help, the tenant has to connect the mailbox again.
function isPermanentSmtpFailure(err: SmtpFailureError): boolean {
  return err.failure === "tlsFailed" || (err.failure === "hostUnreachable" && err.blocked);
}

export function toFoundationSendError(err: SmtpFailureError): Error {
  if (isPermanentSmtpFailure(err)) return new MailSendNotConfiguredError(err.message);
  switch (err.failure) {
    case "loginRejected":
      return new InboundAuthError(err.message);
    case "rejected":
      return new MailSendRejectedError(err.message);
    default:
      return new InboundTransientError(err.message);
  }
}

function stripAngles(id: string): string {
  return id.replace(/^<|>$/g, "");
}

// A missing or unreadable credential document means no login was attempted: the mailbox has to be
// connected again, which is not a rejected password.
async function readSendCredentialDocument(
  ctx: InboundMailContext,
  account: MailAccountRecord,
): Promise<ImapCredentialDocument> {
  try {
    return await readCredentialDocument(ctx, account);
  } catch (err) {
    if (isInboundAuthError(err)) {
      throw new MailSendNotConfiguredError(
        `${FEATURE_NAME}: account ${account.id} has no usable credential document`,
      );
    }
    throw err;
  }
}

export async function sendFromImapAccount(
  ctx: InboundMailContext,
  account: MailAccountRecord,
  message: OutboundMailMessage,
  attachments: readonly OutboundAttachment[],
): Promise<ProviderSentMail> {
  const doc = await readSendCredentialDocument(ctx, account);
  if (!doc.smtpHost || !doc.password) {
    throw new MailSendNotConfiguredError(
      `${FEATURE_NAME}: account ${account.id} has no outgoing server stored`,
    );
  }

  const displayName = sanitizeMailDisplayName(account.displayName);
  const mime = new MailComposer({
    from: displayName ? { name: displayName, address: account.address } : account.address,
    to: [...message.to],
    ...(message.cc && { cc: [...message.cc] }),
    subject: message.subject,
    ...(message.text !== undefined && { text: message.text }),
    ...(message.html !== undefined && { html: message.html }),
    ...(message.inReplyTo && { inReplyTo: message.inReplyTo }),
    ...(message.references && { references: [...message.references] }),
    ...(attachments.length > 0 && {
      attachments: attachments.map((attachment) => ({
        filename: attachment.fileName,
        contentType: attachment.mimeType,
        content: Buffer.from(attachment.data),
      })),
    }),
  }).compile();
  const raw = await mime.build();

  let rejectedRecipients: readonly string[];
  try {
    ({ rejectedRecipients } = await sendRawViaSmtp(
      { host: doc.smtpHost, port: doc.smtpPort, user: doc.user, password: doc.password },
      { from: account.address, to: [...message.to, ...(message.cc ?? [])] },
      raw,
    ));
  } catch (err) {
    throw err instanceof SmtpFailureError ? toFoundationSendError(err) : err;
  }

  // Detached: the copy is best effort and must not keep the caller (maybe inside a request
  // transaction) waiting for another server round trip; appendToSentFolder never rejects.
  void appendToSentFolder(doc, raw, account.id);
  return {
    messageIdHeader: stripAngles(mime.messageId()),
    ...(rejectedRecipients.length > 0 && { rejectedRecipients }),
  };
}
