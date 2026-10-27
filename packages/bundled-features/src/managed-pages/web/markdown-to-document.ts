import { escapeHtml } from "@cosmicdrift/kumiko-renderer/headless";
import { Marked } from "marked";

// Raw HTML in a Markdown body is shown as text, never passed into the editor.
const converter = new Marked({ gfm: false, breaks: false });
converter.use({
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
  },
});

export function markdownToDocumentHtml(markdown: string): string {
  const html = converter.parse(markdown, { async: false });
  if (typeof html !== "string") throw new Error("marked returned a promise for a sync parse");
  return html;
}
