// Server-only (happy-dom). Prepares a rendered document body for the browser
// that prints it: repeating table headers become real <thead> rows, and
// everything that would make the browser fetch something external is removed.

import type { Element as ScanElement } from "happy-dom";
import { withParsedDocument } from "./document-sanitizer.ts";

const REPEAT_HEADER_ATTRIBUTE = "data-repeat-header";
const FETCHING_ELEMENTS =
  "script, link, iframe, object, embed, video, audio, source, meta, base, style";
const FETCHING_ATTRIBUTES = ["src", "srcset", "poster", "background", "data"] as const;
// Anchors only navigate; on svg image/use/feImage an href fetches.
const HREF_ATTRIBUTES = ["href", "xlink:href"] as const;
const EXTERNAL_STYLE_REFERENCE = /url\(|@import/i;

function isEmbeddedValue(value: string): boolean {
  return value.trim().toLowerCase().startsWith("data:");
}

function moveRepeatHeadersIntoThead(table: ScanElement): void {
  const rows = Array.from(table.querySelectorAll("tr")).filter(
    (row) => row.closest("table") === table,
  );
  const leading: ScanElement[] = [];
  for (const row of rows) {
    if (!row.hasAttribute(REPEAT_HEADER_ATTRIBUTE)) break;
    leading.push(row);
  }
  // skip: a table without leading repeat-header rows keeps its structure as written
  if (leading.length === 0) return;
  const thead = table.ownerDocument.createElement("thead");
  for (const row of leading) {
    row.removeAttribute(REPEAT_HEADER_ATTRIBUTE);
    thead.appendChild(row);
  }
  table.insertBefore(thead, table.firstChild);
}

export function prepareDocumentForPrint(html: string): string {
  return withParsedDocument(html, (body) => {
    for (const table of Array.from(body.querySelectorAll("table"))) {
      moveRepeatHeadersIntoThead(table);
    }
    for (const element of Array.from(body.querySelectorAll(FETCHING_ELEMENTS))) element.remove();
    for (const element of Array.from(body.querySelectorAll("*"))) {
      for (const name of FETCHING_ATTRIBUTES) {
        const value = element.getAttribute(name);
        if (value !== null && !isEmbeddedValue(value)) element.removeAttribute(name);
      }
      if (element.tagName.toLowerCase() !== "a") {
        for (const name of HREF_ATTRIBUTES) element.removeAttribute(name);
      }
      const style = element.getAttribute("style");
      if (style !== null && EXTERNAL_STYLE_REFERENCE.test(style)) element.removeAttribute("style");
    }
    return body.innerHTML;
  });
}
