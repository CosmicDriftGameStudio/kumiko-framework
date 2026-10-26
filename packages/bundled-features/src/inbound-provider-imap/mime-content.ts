// Turns a parsed MIME tree into the content the foundation stores: full text, HTML, real
// attachments, and the attachments it deliberately leaves out. Pure; the parsing itself stays in
// imap-client.ts.

import type {
  RawInboundAttachment,
  SkippedInboundAttachment,
} from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
import { type Attachment, type ParsedMail, simpleParser } from "mailparser";

/** A forwarded mail inside a forwarded mail inside a forwarded mail is still read; deeper is skipped. */
export const MIME_FORWARD_MAX_DEPTH = 3;

const FORWARDED_MESSAGE_MIME = "message/rfc822";
const FALLBACK_ATTACHMENT_NAME = "attachment";

export type MailContent = {
  readonly text: string;
  readonly html: string | null;
  readonly attachments: readonly RawInboundAttachment[];
  readonly skipped: readonly SkippedInboundAttachment[];
};

// Signature logos and tracking pixels travel as inline images; a PDF with a Content-Id (Apple Mail
// inlines PDFs that way) is a real document and must survive.
function isInlineImage(attachment: Attachment): boolean {
  if (!attachment.contentType.toLowerCase().startsWith("image/")) return false;
  const referencedByBody = attachment.related === true;
  const inlineWithContentId =
    attachment.contentDisposition === "inline" && Boolean(attachment.contentId);
  return referencedByBody || inlineWithContentId;
}

function forwardedHeader(inner: ParsedMail): string {
  return `\n\n---------- Forwarded message ----------\nFrom: ${inner.from?.text ?? ""}\nSubject: ${inner.subject ?? ""}\n\n`;
}

export async function extractMailContent(parsed: ParsedMail, depth = 0): Promise<MailContent> {
  let text = parsed.text?.trim() ?? "";
  const attachments: RawInboundAttachment[] = [];
  const skipped: SkippedInboundAttachment[] = [];
  for (const attachment of parsed.attachments) {
    const mimeType = attachment.contentType;
    if (isInlineImage(attachment)) continue;
    if (mimeType.toLowerCase() === FORWARDED_MESSAGE_MIME) {
      if (depth + 1 > MIME_FORWARD_MAX_DEPTH) {
        skipped.push({ mimeType, size: attachment.size, reason: "nesting_too_deep" });
        continue;
      }
      const innerParsed = await simpleParser(attachment.content);
      const inner = await extractMailContent(innerParsed, depth + 1);
      text += forwardedHeader(innerParsed) + inner.text;
      attachments.push(...inner.attachments);
      skipped.push(...inner.skipped);
      continue;
    }
    attachments.push({
      fileName: attachment.filename ?? FALLBACK_ATTACHMENT_NAME,
      mimeType,
      data: attachment.content,
    });
  }
  return { text, html: parsed.html || null, attachments, skipped };
}
