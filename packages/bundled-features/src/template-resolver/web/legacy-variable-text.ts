import { isDocumentReferenceName } from "./document-reference-name.ts";

// Matches tags with quoted attribute values, so a `>` inside an attribute does not end the tag.
const HTML_TAG = /(<(?:"[^"]*"|'[^']*'|[^>"'])*>)/;
// Triple braces are raw output and `{{else}}`/`{{this}}` belong to blocks; neither is a variable.
const TEXT_VARIABLE = /(?<!\{)\{\{\s*([^{}\s]+)\s*\}\}(?!\})/g;
const BLOCK_KEYWORDS: ReadonlySet<string> = new Set(["else", "this"]);

function isLegacyVariableName(name: string): boolean {
  return isDocumentReferenceName(name) && !BLOCK_KEYWORDS.has(name);
}

// Content saved by the old editors holds `{{name}}` as plain text; the document editor
// keeps variables as data-variable nodes and would show it as literal text.
export function convertLegacyVariableText(html: string): string {
  return html
    .split(HTML_TAG)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part.replace(TEXT_VARIABLE, (match, name: string) =>
            isLegacyVariableName(name) ? `<span data-variable="${name}"></span>` : match,
          ),
    )
    .join("");
}
