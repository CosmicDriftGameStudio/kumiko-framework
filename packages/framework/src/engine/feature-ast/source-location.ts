// SourceLocation — where a recognised `r.*` call (or an opaque code
// region inside one) lives in the feature file. Attached to every
// FeaturePattern by the AST visitor so:
//
//   - the Designer can scroll to the file region ("show source")
//   - the AI patcher can replace that exact region without regenerating
//     the rest of the file
//   - opaque bodies (writeHandler closures, hook fns, etc.) can be
//     rendered as read-only code blocks (raw carries the full source)
//
// Lines + columns are 1-based to match the LSP / Monaco / CodeMirror
// convention — the Designer can pass them through unchanged.

import type { Node, SourceFile } from "ts-morph";

export type SourcePosition = {
  readonly line: number;
  readonly column: number;
};

export type SourceLocation = {
  readonly file: string;
  readonly start: SourcePosition;
  readonly end: SourcePosition;
  // Raw source text from the start..end range. For round-trip display
  // (rendering custom bodies as read-only blocks in the Designer) +
  // diff generation when patching (compare original vs new).
  readonly raw: string;
};

/**
 * Build a SourceLocation from a ts-morph Node. Lives here (not in
 * parse.ts) so extractors can use it without importing parse.ts —
 * keeps the dependency graph one-way.
 */
export function sourceLocationFromNode(node: Node, sourceFile: SourceFile): SourceLocation {
  const start = sourceFile.getLineAndColumnAtPos(node.getStart());
  const end = sourceFile.getLineAndColumnAtPos(node.getEnd());
  return {
    file: sourceFile.getFilePath(),
    start: { line: start.line, column: start.column },
    end: { line: end.line, column: end.column },
    raw: node.getText(),
  };
}
