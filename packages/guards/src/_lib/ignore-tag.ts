import { type Node, SyntaxKind } from "ts-morph";

function lineHasTag(node: Node, line: number, tag: string): boolean {
  const lines = node.getSourceFile().getFullText().split("\n");
  return (lines[line - 1] ?? "").includes(tag) || (lines[line - 2] ?? "").includes(tag);
}

/** Inline allowlist convention: `// kumiko-lint-ignore <slug> <reason>` on the
 *  violation's own line or the line above. For JSX attributes (style=,
 *  className= in multi-line tags) the opening element's line also counts —
 *  a comment between JSX attributes is not syntactically possible, so the
 *  tag then sits above the `<Element`. */
export function hasIgnoreTag(node: Node, tag: string): boolean {
  if (lineHasTag(node, node.getStartLineNumber(), tag)) return true;
  if (node.getKind() === SyntaxKind.JsxAttribute) {
    const opening =
      node.getFirstAncestorByKind(SyntaxKind.JsxOpeningElement) ??
      node.getFirstAncestorByKind(SyntaxKind.JsxSelfClosingElement);
    if (opening !== undefined && lineHasTag(node, opening.getStartLineNumber(), tag)) {
      return true;
    }
  }
  return false;
}
