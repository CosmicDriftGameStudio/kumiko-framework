import { Lexer, type Token } from "marked";

export const LOSSY_MARKDOWN_FEATURES = ["image", "blockquote", "code", "deepHeading"] as const;
export type LossyMarkdownFeature = (typeof LOSSY_MARKDOWN_FEATURES)[number];

// The document editor has no image, quote or code nodes and only three heading levels.
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
