// Server-only (happy-dom). Frames are read from the stored body for page planning, and flattened
// for the editor preview, which shows the body outside a page where absolute coordinates mean nothing.
import { withParsedDocument } from "./document-sanitizer.ts";
import { type DocumentFrameAttributes, readFrameAttributes } from "./web/document-print-style.ts";

const PREVIEW_FRAME_STYLE =
  "margin:8px 0;padding:6px;border:1px dashed #9ca3af;white-space:pre-line";

export function readTopLevelFrames(html: string): readonly DocumentFrameAttributes[] {
  return withParsedDocument(html, (body) =>
    Array.from(body.children).flatMap((child) => {
      const frame = child.matches("div[data-frame]") ? readFrameAttributes(child) : null;
      return frame === null ? [] : [frame];
    }),
  );
}

export function flattenFramesForPreview(compiledHtml: string): string {
  return withParsedDocument(compiledHtml, (body) => {
    for (const frame of Array.from(body.querySelectorAll("div.kumiko-frame"))) {
      frame.setAttribute("style", PREVIEW_FRAME_STYLE);
    }
    return body.innerHTML;
  });
}
