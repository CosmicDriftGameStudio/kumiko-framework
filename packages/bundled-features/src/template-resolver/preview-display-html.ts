import type { InlineAttachmentRef } from "../renderer-foundation/index.ts";

export const PREVIEW_IMAGE_BUDGET_BYTES = 5 * 1024 * 1024;

const DISPLAYABLE_IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export type PreviewAttachmentReader = (
  ref: InlineAttachmentRef,
) => Promise<{ readonly content: Uint8Array; readonly contentType: string } | null>;

// The preview shows images the mail client would resolve by Content-ID; a browser cannot, so each
// resolved image becomes a data URI. `html` itself stays untouched because the send path needs the cids.
export async function buildDisplayHtml(
  html: string,
  inline: readonly InlineAttachmentRef[],
  readAttachment: PreviewAttachmentReader,
): Promise<string> {
  let displayHtml = html;
  let usedBytes = 0;
  for (const ref of inline) {
    const needle = `src="cid:${ref.cid}"`;
    if (!displayHtml.includes(needle)) continue;
    const found = await readAttachment(ref);
    if (found === null || !DISPLAYABLE_IMAGE_TYPES.has(found.contentType)) continue;
    if (usedBytes + found.content.length > PREVIEW_IMAGE_BUDGET_BYTES) continue;
    usedBytes += found.content.length;
    const dataUri = `src="data:${found.contentType};base64,${Buffer.from(found.content).toString("base64")}"`;
    displayHtml = displayHtml.replaceAll(needle, () => dataUri);
  }
  return displayHtml;
}
