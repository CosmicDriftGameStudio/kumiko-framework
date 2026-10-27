import { isAllowedDocumentLinkHref } from "@cosmicdrift/kumiko-bundled-features/template-resolver/document-schema";
import { Lexer, type Token } from "marked";

export const LOSSY_MARKDOWN_FEATURES = [
  "image",
  "blockquote",
  "code",
  "deepHeading",
  "relativeLink",
] as const;
export type LossyMarkdownFeature = (typeof LOSSY_MARKDOWN_FEATURES)[number];

// The document editor has no image, quote or code nodes, only three heading
// levels, and links must pass the document link policy (absolute http(s),
// mailto, tel, placeholders).
const MAX_DOCUMENT_HEADING_DEPTH = 3;

function tokenList(value: unknown): readonly Token[] {
  return Array.isArray(value) ? value : [];
}

function childTokens(token: Token): readonly Token[] {
  const nested = [...tokenList("tokens" in token ? token.tokens : undefined)];
  if (token.type === "list") nested.push(...tokenList("items" in token ? token.items : undefined));
  return nested;
}

function isDeepHeading(token: Token): boolean {
  return (
    "depth" in token && typeof token.depth === "number" && token.depth > MAX_DOCUMENT_HEADING_DEPTH
  );
}

function isRelativeLink(token: Token): boolean {
  return (
    "href" in token && typeof token.href === "string" && !isAllowedDocumentLinkHref(token.href)
  );
}

function featuresOf(token: Token): readonly LossyMarkdownFeature[] {
  switch (token.type) {
    case "image":
      return ["image"];
    case "blockquote":
      return ["blockquote"];
    case "code":
    case "codespan":
      return ["code"];
    case "heading":
      return isDeepHeading(token) ? ["deepHeading"] : [];
    case "link":
      return isRelativeLink(token) ? ["relativeLink"] : [];
    default:
      return [];
  }
}

function collect(tokens: readonly Token[], found: Set<LossyMarkdownFeature>): void {
  for (const token of tokens) {
    for (const feature of featuresOf(token)) found.add(feature);
    collect(childTokens(token), found);
  }
}

// Lexer options match the renderer used for conversion (gfm off), so the
// warning lists exactly what the converted HTML loses.
export function detectLossyMarkdown(markdown: string): readonly LossyMarkdownFeature[] {
  const found = new Set<LossyMarkdownFeature>();
  collect(new Lexer({ gfm: false, breaks: false }).lex(markdown), found);
  return LOSSY_MARKDOWN_FEATURES.filter((feature) => found.has(feature));
}
