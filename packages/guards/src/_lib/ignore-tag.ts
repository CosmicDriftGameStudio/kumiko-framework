import { type Node, SyntaxKind } from "ts-morph";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when `line` carries `tag` (`<prefix> <slug>`), either alone or as one
 *  entry of a comma-separated slug list: `// kumiko-lint-ignore a,b <reason>`. */
export function lineHasIgnoreTag(line: string, tag: string): boolean {
  if (line.includes(tag)) return true;
  const slugStart = tag.lastIndexOf(" ");
  if (slugStart < 0) return false;
  const prefix = escapeRegExp(tag.slice(0, slugStart));
  const slug = escapeRegExp(tag.slice(slugStart + 1));
  return new RegExp(`${prefix}\\s+(?:[\\w-]+,)*${slug}(?=[\\s,]|$)`).test(line);
}

function taggedLineAt(node: Node, line: number, tag: string): string | undefined {
  const lines = node.getSourceFile().getFullText().split("\n");
  for (const candidate of [lines[line - 1] ?? "", lines[line - 2] ?? ""]) {
    if (lineHasIgnoreTag(candidate, tag)) return candidate;
  }
  return undefined;
}

/** Same lookup as `hasIgnoreTag`, but returns the tagged line so callers can read the reason. */
export function ignoreTagLine(node: Node, tag: string): string | undefined {
  const own = taggedLineAt(node, node.getStartLineNumber(), tag);
  if (own !== undefined) return own;
  if (node.getKind() === SyntaxKind.JsxAttribute) {
    const opening =
      node.getFirstAncestorByKind(SyntaxKind.JsxOpeningElement) ??
      node.getFirstAncestorByKind(SyntaxKind.JsxSelfClosingElement);
    if (opening !== undefined) return taggedLineAt(node, opening.getStartLineNumber(), tag);
  }
  return undefined;
}

/** Inline allowlist convention: `// kumiko-lint-ignore <slug> <reason>` on the
 *  violation's own line or the line above. For JSX attributes (style=,
 *  className= in multi-line tags) the opening element's line also counts —
 *  a comment between JSX attributes is not syntactically possible, so the
 *  tag then sits above the `<Element`. */
export function hasIgnoreTag(node: Node, tag: string): boolean {
  return ignoreTagLine(node, tag) !== undefined;
}
