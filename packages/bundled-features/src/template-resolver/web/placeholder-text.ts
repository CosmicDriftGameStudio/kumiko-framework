import type { JSONContent } from "@tiptap/core";
import { isDocumentReferenceName } from "./document-schema.ts";

const PLACEHOLDER_TOKEN = /\{\{([^{}]*)\}\}/g;

// Names the schema refuses stay plain text, so a typo never becomes a chip
// that the server would reject.
export function lineToContent(text: string): JSONContent[] {
  const content: JSONContent[] = [];
  let cursor = 0;
  const pushText = (value: string): void => {
    if (value !== "") content.push({ type: "text", text: value });
  };
  for (const match of text.matchAll(PLACEHOLDER_TOKEN)) {
    const name = match[1] ?? "";
    if (!isDocumentReferenceName(name)) continue;
    pushText(text.slice(cursor, match.index));
    content.push({ type: "variable", attrs: { name } });
    cursor = match.index + match[0].length;
  }
  pushText(text.slice(cursor));
  return content;
}

export function contentToLine(nodes: readonly JSONContent[] | undefined): string {
  return (nodes ?? [])
    .map((node) => {
      if (node.type === "variable") return `{{${String(node.attrs?.["name"])}}}`;
      return node.type === "text" ? (node.text ?? "") : "";
    })
    .join("");
}

export function singleLine(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, " ");
}
