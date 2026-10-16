import { MAX_EMAIL_ATTACHMENTS } from "@cosmicdrift/kumiko-bundled-features/delivery";
import {
  type FileAttachmentRef,
  type InlineAttachmentRef,
  RendererError,
} from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";

// Inline images come first so their order in the mail matches the body; the delivery layer
// rejects more than MAX_EMAIL_ATTACHMENTS, so the render fails here with the slug instead.
export function combineMailAttachments(
  slug: string,
  inline: readonly InlineAttachmentRef[],
  files: readonly FileAttachmentRef[],
): readonly (InlineAttachmentRef | FileAttachmentRef)[] {
  const attachments = [...inline, ...files];
  if (attachments.length > MAX_EMAIL_ATTACHMENTS) {
    throw new RendererError(
      `renderer-mail-html: mail "${slug}" would carry ${attachments.length} attachments (${inline.length} inline images, ${files.length} files), the limit is ${MAX_EMAIL_ATTACHMENTS}`,
      "other",
    );
  }
  return attachments;
}
