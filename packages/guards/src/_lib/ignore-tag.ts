import { type Node, type SourceFile, SyntaxKind } from "ts-morph";

export const FILE_IGNORE_TAG_PREFIX = "kumiko-lint-ignore-file";

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

// Module state, not a parameter: hasIgnoreTag is called deep inside the guards, and runGuards runs them
// sequentially in one process and resets the ledger before each run.
const usedIgnoreTags = new Set<string>();

function ledgerKey(filePath: string, line: number, slug: string): string {
  return `${filePath}\0${line}\0${slug}`;
}

export function ignoreTagSlug(tag: string): string {
  return tag.slice(tag.lastIndexOf(" ") + 1);
}

export function resetIgnoreTagUses(): void {
  usedIgnoreTags.clear();
}

export function isIgnoreTagUsed(filePath: string, line: number, slug: string): boolean {
  return usedIgnoreTags.has(ledgerKey(filePath, line, slug));
}

/** lineHasIgnoreTag on the 1-based `line` of `sf`, recording a hit as a used marker. */
export function consumeIgnoreTagOnLine(sf: SourceFile, line: number, tag: string): boolean {
  const text = sf.getFullText().split("\n")[line - 1] ?? "";
  if (!lineHasIgnoreTag(text, tag)) return false;
  usedIgnoreTags.add(ledgerKey(sf.getFilePath(), line, ignoreTagSlug(tag)));
  return true;
}

// Not anchored: lineHasIgnoreTag honours the tag anywhere in a line, so a prefixed tag must be checked too.
export const KUMIKO_IGNORE_TAG_RE = /\bkumiko-lint-ignore\s+(\S+)(?:\s+(\S.*|))?$/;

// Also matches the file-wide `kumiko-lint-ignore-file` form: reason checks cover both, the ledger tracks line markers only.
export const KUMIKO_IGNORE_ANY_TAG_RE = /\bkumiko-lint-ignore(?:-file)?\s+(\S+)(?:\s+(\S.*|))?$/;

function taggedLineAt(node: Node, line: number, tag: string): string | undefined {
  const sf = node.getSourceFile();
  const lines = sf.getFullText().split("\n");
  for (const candidate of [line, line - 1]) {
    if (consumeIgnoreTagOnLine(sf, candidate, tag)) return lines[candidate - 1] ?? "";
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

/** File-wide form: `// kumiko-lint-ignore-file <slug> <reason>` in the leading
 *  comment block, before the first statement. A marker further down (or inside
 *  a string literal) does not count. Returns the tagged line so callers can read the reason. */
export function fileIgnoreTagLine(sourceFile: SourceFile, slug: string): string | undefined {
  const fullText = sourceFile.getFullText();
  const head = fullText.slice(0, sourceFile.getStatements()[0]?.getStart() ?? fullText.length);
  const tag = `${FILE_IGNORE_TAG_PREFIX} ${slug}`;
  return head.split("\n").find((line) => lineHasIgnoreTag(line, tag));
}
