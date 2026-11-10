// Server-only (happy-dom). Frames are read from the stored body for page planning, and flattened
// for the editor preview, which shows the body outside a page where absolute coordinates mean nothing.
import type { Element as ScanElement, Node as ScanNode } from "happy-dom";
import { appendStyle } from "./compile-document-styles.ts";
import { withParsedDocument } from "./document-sanitizer.ts";
import { type DocumentFrameAttributes, readFrameAttributes } from "./web/document-print-style.ts";
import { addressParagraphCss, SENDER_LINE_SIZE_PT } from "./web/document-style-css.ts";

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

const TEXT_NODE_TYPE = 3;
const ELEMENT_NODE_TYPE = 1;
const SENDER_SIZE_SELECTOR = `[data-size-pt="${SENDER_LINE_SIZE_PT}"]`;
const ADDRESS_FIRST_PARAGRAPH_SELECTOR =
  "div.kumiko-frame[data-frame-preset=address] > p:first-child";

function nonBlankTextNodes(node: ScanNode): ScanNode[] {
  if (node.nodeType === TEXT_NODE_TYPE) return (node.textContent ?? "").trim() === "" ? [] : [node];
  if (node.nodeType !== ELEMENT_NODE_TYPE) return [];
  return Array.from(node.childNodes).flatMap(nonBlankTextNodes);
}

// Without the sender checkbox the first paragraph is the recipient and must stay as written.
function isSenderLine(paragraph: ScanElement): boolean {
  const texts = nonBlankTextNodes(paragraph);
  return (
    texts.length > 0 &&
    texts.every((text) => text.parentElement?.closest(SENDER_SIZE_SELECTOR) != null)
  );
}

// The sender line is a single line, so a multi-line company address has to read with the same
// separator the editor uses between name and address. Its rule and spacing come from the same
// CSS builder as the editor decoration.
export function flattenAddressSenderLine(compiledHtml: string): string {
  if (!compiledHtml.includes("data-frame-preset")) return compiledHtml;
  return withParsedDocument(compiledHtml, (body) => {
    let changed = false;
    for (const paragraph of Array.from(body.querySelectorAll(ADDRESS_FIRST_PARAGRAPH_SELECTOR))) {
      if (!isSenderLine(paragraph)) continue;
      for (const text of nonBlankTextNodes(paragraph)) {
        text.textContent = (text.textContent ?? "").replace(/\s*\r?\n\s*/g, " · ");
      }
      appendStyle(paragraph, addressParagraphCss(true));
      changed = true;
    }
    return changed ? body.innerHTML : compiledHtml;
  });
}
