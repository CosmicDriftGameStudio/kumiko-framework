import { Node } from "ts-morph";

const ESCAPE_SEQUENCE_RE = /\\[ux0-7]/;

// Text prefilters search raw file text, which a string-literal escape (`_`, `\x20`, octal)
// can spell around; such files must still go through the AST check.
export function mayContainEscapedLiteral(text: string): boolean {
  return ESCAPE_SEQUENCE_RE.test(text);
}

// Source text of a string-like literal with escapes resolved, so `"set_config"` matches
// what the runtime sees. Literals without escapes keep their raw text (quotes included).
export function decodedLiteralText(node: Node): string {
  const raw = node.getText();
  if (!mayContainEscapedLiteral(raw)) return raw;
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralText();
  }
  if (Node.isTemplateExpression(node)) {
    const spans = node
      .getTemplateSpans()
      .map((span) => `\${${span.getExpression().getText()}}${span.getLiteral().getLiteralText()}`);
    return [node.getHead().getLiteralText(), ...spans].join("");
  }
  return raw;
}
