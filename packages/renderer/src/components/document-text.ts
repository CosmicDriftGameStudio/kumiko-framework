import { escapeHtml } from "../headless/format/escape.ts";

const ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

// Splitting on ">" instead of matching "<[^>]*>" keeps the strip linear for unclosed "<".
function stripTags(text: string): string {
  const segments = text.split(">");
  const unclosedRest = segments.pop() ?? "";
  const keptText = segments.map((segment) => {
    const tagStart = segment.indexOf("<");
    return tagStart === -1 ? `${segment}>` : segment.slice(0, tagStart);
  });
  return keptText.join("") + unclosedRest;
}

// Regex instead of DOMParser: the renderer also runs on React Native, which has no DOM.
export function documentHtmlToText(html: string): string {
  const withBlockBreaks = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, "\n\n");
  return stripTags(withBlockBreaks)
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const NON_TEXT_CONTENT = /<(?:img|table|hr)\b|data-(?:page-break|steps|images|button)\b/i;

// A document holding only an image, divider, table or block is not empty although it has no text.
export function isEmptyDocumentHtml(html: string): boolean {
  return documentHtmlToText(html) === "" && !NON_TEXT_CONTENT.test(html);
}

/** Blank line starts a paragraph, a single newline becomes a hard break. */
export function textToDocumentHtml(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "")
    .map((paragraph) => escapeHtml(paragraph).replace(/\n/g, "<br>"))
    .map((paragraphHtml) => `<p>${paragraphHtml}</p>`)
    .join("");
}
