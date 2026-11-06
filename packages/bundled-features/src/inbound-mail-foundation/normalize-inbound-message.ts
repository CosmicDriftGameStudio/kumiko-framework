// Provider-agnostic hardening of a fetched message before it is dispatched to
// ingest-message. The ingest schema rejects oversized or empty fields; one such
// mail would otherwise block the cursor of its mailbox forever.

import type { RawInboundAttachment, RawInboundMessage, SkippedInboundAttachment } from "./types.ts";

export const INBOUND_MISSING_SENDER = "(no sender)";
export const INBOUND_BODY_TEXT_MAX_CHARS = 32_000;
// Counted in UTF-8 bytes, not characters: the ciphertext grows with the bytes, and a CJK or emoji
// mail of 500,000 characters would encrypt past the event's bodyHtml maximum.
export const INBOUND_BODY_HTML_MAX_BYTES = 500_000;
export const INBOUND_BODY_HTML_MAX_CHARS = 5_000_000;
export const INBOUND_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
export const INBOUND_MAIL_ATTACHMENTS_MAX_BYTES = 50 * 1024 * 1024;
// The .eml holds every attachment again, so it shares the per-mail byte budget.
export const INBOUND_RAW_MIME_MAX_BYTES = INBOUND_MAIL_ATTACHMENTS_MAX_BYTES;
export const INBOUND_ATTACHMENTS_MAX_COUNT = 50;
export const INBOUND_SKIPPED_ATTACHMENTS_MAX_COUNT = 200;

export const INBOUND_FROM_MAX_CHARS = 2000;
export const INBOUND_SUBJECT_MAX_CHARS = 4000;
export const INBOUND_SNIPPET_MAX_CHARS = 4000;
export const INBOUND_MAIL_ADDRESS_MAX_CHARS = 320;
// Plaintext of one JSON-stringified to/cc list; its ciphertext must fit the event and entity field.
export const INBOUND_ADDRESS_LIST_JSON_MAX_CHARS = 8000;
const ADDRESS_MAX = 2000;
const ADDRESS_LIST_MAX = 200;
const REFERENCE_MAX = 500;
const REFERENCES_MAX = 200;
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

function limitAddressList(list: readonly string[]): readonly string[] {
  const kept = list.slice(0, ADDRESS_LIST_MAX).map((a) => clip(a, ADDRESS_MAX));
  while (kept.length > 0 && JSON.stringify(kept).length > INBOUND_ADDRESS_LIST_JSON_MAX_CHARS) {
    kept.pop();
  }
  return kept;
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
    from: from.length === 0 ? INBOUND_MISSING_SENDER : clip(from, INBOUND_FROM_MAX_CHARS),
    to: limitAddressList(msg.to),
    cc: limitAddressList(msg.cc),
    subject: clip(msg.subject, INBOUND_SUBJECT_MAX_CHARS),
    snippet: clip(msg.snippet, INBOUND_SNIPPET_MAX_CHARS),
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
