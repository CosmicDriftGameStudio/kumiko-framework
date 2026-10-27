import { isAllowedDocumentLinkHref } from "@cosmicdrift/kumiko-bundled-features/template-resolver/document-schema";
import { escapeHtml } from "@cosmicdrift/kumiko-renderer/headless";
import { Marked } from "marked";

// The server sanitizer rejects what it cannot keep, so the conversion drops it up front and the
// lossy banner stays true: a link outside the document link policy keeps its text, an image
// (no uploaded resource to point at) is dropped, and raw HTML is shown as text.
const converter = new Marked({ gfm: false, breaks: false });
converter.use({
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
    link({ href, tokens }) {
      return isAllowedDocumentLinkHref(href) ? false : this.parser.parseInline(tokens);
    },
    image() {
      return "";
    },
  },
});

export function markdownToDocumentHtml(markdown: string): string {
  const html = converter.parse(markdown, { async: false });
  if (typeof html !== "string") throw new Error("marked returned a promise for a sync parse");
  return html;
}
