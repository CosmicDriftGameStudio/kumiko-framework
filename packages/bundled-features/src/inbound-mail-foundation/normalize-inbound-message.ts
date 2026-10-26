// Provider-agnostic hardening of a fetched message before it is dispatched to
// ingest-message. The ingest schema rejects oversized or empty fields; one such
// mail would otherwise block the cursor of its mailbox forever.

import type { RawInboundAttachment, RawInboundMessage, SkippedInboundAttachment } from "./types.ts";

export const INBOUND_MISSING_SENDER = "(no sender)";
export const INBOUND_BODY_TEXT_MAX_CHARS = 32_000;
export const INBOUND_BODY_HTML_MAX_CHARS = 5_000_000;
export const INBOUND_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
export const INBOUND_MAIL_ATTACHMENTS_MAX_BYTES = 50 * 1024 * 1024;
// The .eml holds every attachment again, so it shares the per-mail byte budget.
export const INBOUND_RAW_MIME_MAX_BYTES = INBOUND_MAIL_ATTACHMENTS_MAX_BYTES;
export const INBOUND_ATTACHMENTS_MAX_COUNT = 50;
export const INBOUND_SKIPPED_ATTACHMENTS_MAX_COUNT = 200;

const FROM_MAX = 2000;
const ADDRESS_MAX = 2000;
const ADDRESS_LIST_MAX = 200;
const REFERENCE_MAX = 500;
const REFERENCES_MAX = 200;
const SUBJECT_MAX = 4000;
const SNIPPET_MAX = 4000;
const MESSAGE_ID_HEADER_MAX = 500;

export type NormalizedInboundMessage = Omit<
  RawInboundMessage,
  "text" | "html" | "attachments" | "skippedAttachments"
> & {
  readonly bodyText: string;
  readonly bodyTextTruncated: boolean;
  readonly bodyHtml: string | null;
  readonly attachments: readonly RawInboundAttachment[];
  readonly skippedAttachments: readonly SkippedInboundAttachment[];
};

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

// Cuts at UTF-16 units like the zod max, but never leaves half a surrogate pair behind.
function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = isHighSurrogate(value.charCodeAt(max - 1)) ? max - 1 : max;
  return value.slice(0, cut);
}

function limitReferences(references: readonly string[]): readonly string[] {
  const usable = references.filter((r) => r.length > 0 && r.length <= REFERENCE_MAX);
  if (usable.length <= REFERENCES_MAX) return usable;
  // The root keeps the thread anchor, the newest entries keep the reply chain.
  return [...usable.slice(0, 1), ...usable.slice(usable.length - (REFERENCES_MAX - 1))];
}

type AttachmentSplit = {
  readonly stored: readonly RawInboundAttachment[];
  readonly skipped: readonly SkippedInboundAttachment[];
};

function splitAttachmentsByLimits(attachments: readonly RawInboundAttachment[]): AttachmentSplit {
  const stored: RawInboundAttachment[] = [];
  const skipped: SkippedInboundAttachment[] = [];
  let totalBytes = 0;
  for (const attachment of attachments) {
    const size = attachment.data.byteLength;
    if (size > INBOUND_ATTACHMENT_MAX_BYTES) {
      skipped.push({ mimeType: attachment.mimeType, size, reason: "too_large" });
    } else if (
      totalBytes + size > INBOUND_MAIL_ATTACHMENTS_MAX_BYTES ||
      stored.length >= INBOUND_ATTACHMENTS_MAX_COUNT
    ) {
      skipped.push({ mimeType: attachment.mimeType, size, reason: "mail_too_large" });
    } else {
      totalBytes += size;
      stored.push({
        fileName: clip(attachment.fileName, 255),
        mimeType: clip(attachment.mimeType, 255),
        data: attachment.data,
      });
    }
  }
  return { stored, skipped };
}

export function normalizeRawInboundMessage(msg: RawInboundMessage): NormalizedInboundMessage {
  const { text, html, attachments, skippedAttachments, ...envelope } = msg;
  const from = msg.from.trim();
  const fullText = text ?? "";
  const split = splitAttachmentsByLimits(attachments ?? []);
  const bodyHtml = html ?? null;
  const rawMimeTooLarge =
    msg.rawMime !== null && msg.rawMime.byteLength > INBOUND_RAW_MIME_MAX_BYTES;
  const skippedRawMime: readonly SkippedInboundAttachment[] =
    rawMimeTooLarge && msg.rawMime !== null
      ? [{ mimeType: "message/rfc822", size: msg.rawMime.byteLength, reason: "too_large" }]
      : [];
  return {
    ...envelope,
    rawMime: rawMimeTooLarge ? null : msg.rawMime,
    messageIdHeader:
      msg.messageIdHeader !== null && msg.messageIdHeader.length <= MESSAGE_ID_HEADER_MAX
        ? msg.messageIdHeader
        : null,
    references: limitReferences(msg.references),
    from: from.length === 0 ? INBOUND_MISSING_SENDER : clip(from, FROM_MAX),
    to: msg.to.slice(0, ADDRESS_LIST_MAX).map((a) => clip(a, ADDRESS_MAX)),
    cc: msg.cc.slice(0, ADDRESS_LIST_MAX).map((a) => clip(a, ADDRESS_MAX)),
    subject: clip(msg.subject, SUBJECT_MAX),
    snippet: clip(msg.snippet, SNIPPET_MAX),
    bodyText: clip(fullText, INBOUND_BODY_TEXT_MAX_CHARS),
    bodyTextTruncated: fullText.length > INBOUND_BODY_TEXT_MAX_CHARS,
    bodyHtml: bodyHtml !== null && bodyHtml.length <= INBOUND_BODY_HTML_MAX_CHARS ? bodyHtml : null,
    attachments: split.stored,
    skippedAttachments: [...(skippedAttachments ?? []), ...split.skipped, ...skippedRawMime].slice(
      0,
      INBOUND_SKIPPED_ATTACHMENTS_MAX_COUNT,
    ),
  };
}
