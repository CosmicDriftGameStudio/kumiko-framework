import {
  MAX_EMAIL_ATTACHMENTS,
  MAX_RENDERED_PDF_VARIABLES_BYTES,
  sanitizePdfAttachmentFileName,
} from "@cosmicdrift/kumiko-bundled-features/delivery";
import {
  type FileAttachmentRef,
  type InlineAttachmentRef,
  type MailAttachmentRef,
  type RenderedPdfAttachmentRef,
  RendererError,
} from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import type { TemplatePdfAttachmentLink } from "@cosmicdrift/kumiko-bundled-features/template-resolver";

export function buildRenderedPdfAttachments(args: {
  readonly slug: string;
  readonly links: readonly TemplatePdfAttachmentLink[];
  readonly variables: Readonly<Record<string, unknown>>;
  readonly locale: string;
  readonly renderFileName: (pattern: string) => string;
}): readonly RenderedPdfAttachmentRef[] {
  const { slug, links, variables, locale, renderFileName } = args;
  if (links.length === 0) return [];
  if (Buffer.byteLength(JSON.stringify(variables)) > MAX_RENDERED_PDF_VARIABLES_BYTES) {
    throw new RendererError(
      `renderer-mail-html: the variables of mail "${slug}" exceed ${MAX_RENDERED_PDF_VARIABLES_BYTES} bytes as JSON, too large to hand to the attached PDF`,
      "invalid_payload",
    );
  }
  return links.map((link) => ({
    kind: "rendered-pdf",
    templateSlug: link.templateSlug,
    variables,
    locale,
    fileName: sanitizePdfAttachmentFileName(renderFileName(link.fileName), link.templateSlug),
  }));
}

// Inline images come first so their order in the mail matches the body; the delivery layer
// rejects more than MAX_EMAIL_ATTACHMENTS, so the render fails here with the slug instead.
export function combineMailAttachments(
  slug: string,
  inline: readonly InlineAttachmentRef[],
  files: readonly FileAttachmentRef[],
  renderedPdfs: readonly RenderedPdfAttachmentRef[],
): readonly MailAttachmentRef[] {
  const attachments = [...inline, ...files, ...renderedPdfs];
  if (attachments.length > MAX_EMAIL_ATTACHMENTS) {
    throw new RendererError(
      `renderer-mail-html: mail "${slug}" would carry ${attachments.length} attachments (${inline.length} inline images, ${files.length} files, ${renderedPdfs.length} rendered PDFs), the limit is ${MAX_EMAIL_ATTACHMENTS}`,
      "other",
    );
  }
  return attachments;
}
