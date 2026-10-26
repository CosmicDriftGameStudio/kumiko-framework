// Outbound half of the provider contract: a reply sent from a connected mailbox through the
// customer's own mail server, never through the platform sender.

import * as z from "zod";

const MAX_RECIPIENTS = 50;
const MAX_REFERENCES = 100;
const MAX_ATTACHMENTS = 10;

/** Raw bytes, not the encoded size: base64 grows them by a third, which stays under the usual 25 MB SMTP limit. */
export const OUTBOUND_ATTACHMENTS_MAX_BYTES = 18 * 1024 * 1024;

// Message ids travel without angle brackets, like RawInboundMessage.references. Anything that
// could close the bracket or start a new header is refused instead of being encoded.
const messageIdSchema = z
  .string()
  .min(1)
  .max(998)
  .regex(/^[^\s<>]+$/);

export const outboundMailMessageSchema = z
  .object({
    to: z.array(z.email().max(320)).min(1).max(MAX_RECIPIENTS),
    cc: z.array(z.email().max(320)).max(MAX_RECIPIENTS).optional(),
    subject: z
      .string()
      .max(998)
      .regex(/^[^\r\n]*$/),
    text: z.string().optional(),
    html: z.string().optional(),
    inReplyTo: messageIdSchema.optional(),
    references: z.array(messageIdSchema).max(MAX_REFERENCES).optional(),
    attachmentFileIds: z.array(z.uuid()).max(MAX_ATTACHMENTS).optional(),
  })
  .refine((message) => message.text !== undefined || message.html !== undefined, {
    message: "needs text or html",
  });
export type OutboundMailMessage = z.infer<typeof outboundMailMessageSchema>;

/** An attachment whose file reference was resolved to bytes before the provider sends. */
export type OutboundAttachment = {
  readonly fileName: string;
  readonly mimeType: string;
  readonly data: Uint8Array;
};

/** What a provider plugin reports about a mail it sent. */
export type ProviderSentMail = {
  /** Message-ID header of the sent mail, without angle brackets. */
  readonly messageIdHeader: string;
};

export type OutboundMailSent = ProviderSentMail & {
  /** The file references that went out as attachments, for the caller's own record of the mail. */
  readonly attachmentFileIds: readonly string[];
};

// Same `kind` discriminant as the inbound error classes (see types.ts).

/** The mailbox has no outgoing server stored, for example a credential document from before
 *  sending existed. The tenant has to connect the mailbox again. */
export class MailSendNotConfiguredError extends Error {
  readonly kind = "mail-send-not-configured-error" as const;
  constructor(message: string) {
    super(message);
    this.name = "MailSendNotConfiguredError";
  }
}

/** The outgoing server accepted the login but refused the mail (recipient, size, policy). */
export class MailSendRejectedError extends Error {
  readonly kind = "mail-send-rejected-error" as const;
  constructor(message: string) {
    super(message);
    this.name = "MailSendRejectedError";
  }
}

export function isMailSendNotConfiguredError(e: unknown): e is MailSendNotConfiguredError {
  return e instanceof Error && "kind" in e && e.kind === "mail-send-not-configured-error";
}
export function isMailSendRejectedError(e: unknown): e is MailSendRejectedError {
  return e instanceof Error && "kind" in e && e.kind === "mail-send-rejected-error";
}
