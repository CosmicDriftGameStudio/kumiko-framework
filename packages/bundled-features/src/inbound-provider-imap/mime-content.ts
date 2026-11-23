// Turns a parsed MIME tree into the content the foundation stores: full text, HTML, real
// attachments, and the attachments it deliberately leaves out. Pure; the parsing itself stays in
// imap-client.ts.

import {
  inboundHtmlToText,
  type RawInboundAttachment,
  type SkippedInboundAttachment,
} from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
import {
  type Attachment,
  type ParsedMail,
  type SimpleParserOptions,
  simpleParser,
} from "mailparser";

// mailparser would convert the HTML to text before our limits apply, and its depth check misses
// alternating elements. A length limit of 0 makes it skip the conversion for every HTML part but,
// unlike skipHtmlToText, report textConversionError when a part had no text alternative, which is
// how mixed mails with a text footer are told apart. cid images stay links because the sanitizer
// drops them anyway and data: URLs would inflate the HTML by up to 20 MB.
export const MAIL_PARSER_OPTIONS: SimpleParserOptions = {
  maxHtmlLengthToParse: 0,
  keepCidLinks: true,
};

function ownTextOf(parsed: ParsedMail): string {
  const text = parsed.text?.trim() ?? "";
  const textMissesHtml = parsed.textConversionError !== undefined || text === "";
  return textMissesHtml && parsed.html ? inboundHtmlToText(parsed.html) : text;
}

/** A forwarded mail inside a forwarded mail inside a forwarded mail is still read; deeper is skipped. */
export const MIME_FORWARD_MAX_DEPTH = 3;

const FORWARDED_MESSAGE_MIME = "message/rfc822";
const FALLBACK_ATTACHMENT_NAME = "attachment";
const FALLBACK_FORWARDED_NAME = "forwarded.eml";

export type MailContent = {
  readonly text: string;
  /** The mail's own text, without attached forwards. */
  readonly ownText: string;
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

async function readForwardedMail(
  source: Buffer,
  depth: number,
): Promise<{ readonly header: string; readonly content: MailContent } | null> {
  try {
    const parsed = await simpleParser(source, MAIL_PARSER_OPTIONS);
    return { header: forwardedHeader(parsed), content: await extractMailContent(parsed, depth) };
  } catch {
    return null;
  }
}

export async function extractMailContent(parsed: ParsedMail, depth = 0): Promise<MailContent> {
  const ownText = ownTextOf(parsed);
  let text = ownText;
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
      const inner = await readForwardedMail(attachment.content, depth + 1);
      if (inner === null) {
        // A forwarded mail the parser chokes on must not sink the outer mail: keep it as a plain .eml.
        attachments.push({
          fileName: attachment.filename ?? FALLBACK_FORWARDED_NAME,
          mimeType,
          data: attachment.content,
        });
        continue;
      }
      text += inner.header + inner.content.text;
      attachments.push(...inner.content.attachments);
      skipped.push(...inner.content.skipped);
      continue;
    }
    attachments.push({
      fileName: attachment.filename ?? FALLBACK_ATTACHMENT_NAME,
      mimeType,
      data: attachment.content,
    });
  }
  return { text, ownText, html: parsed.html || null, attachments, skipped };
}
