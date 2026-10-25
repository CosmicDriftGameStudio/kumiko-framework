// send for the imap provider: SMTP with the mailbox's own login, From = the mailbox address.
// The MIME is built once, so the copy in the sent folder is byte for byte what went out.

import { sanitizeMailDisplayName } from "@cosmicdrift/kumiko-bundled-features/foundation-shared";
import {
  InboundAuthError,
  type InboundMailContext,
  InboundTransientError,
  type MailAccountRecord,
  MailSendNotConfiguredError,
  MailSendRejectedError,
  type OutboundMailMessage,
  type OutboundMailSent,
} from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
import MailComposer from "nodemailer/lib/mail-composer";
import { FEATURE_NAME } from "./constants.ts";
import { readCredentialDocument } from "./credential-document.ts";
import { appendToSentFolder } from "./sent-folder.ts";
import { SmtpFailureError, sendRawViaSmtp } from "./smtp-client.ts";

function toFoundationSendError(err: SmtpFailureError): Error {
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

export async function sendFromImapAccount(
  ctx: InboundMailContext,
  account: MailAccountRecord,
  message: OutboundMailMessage,
): Promise<OutboundMailSent> {
  const doc = await readCredentialDocument(ctx, account);
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
  }).compile();
  const raw = await mime.build();

  try {
    await sendRawViaSmtp(
      { host: doc.smtpHost, port: doc.smtpPort, user: doc.user, password: doc.password },
      { from: account.address, to: [...message.to, ...(message.cc ?? [])] },
      raw,
    );
  } catch (err) {
    throw err instanceof SmtpFailureError ? toFoundationSendError(err) : err;
  }

  await appendToSentFolder(doc, raw, account.id);
  return { messageIdHeader: stripAngles(mime.messageId()) };
}
