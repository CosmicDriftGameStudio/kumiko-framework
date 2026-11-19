#!/usr/bin/env bun
// guard-markers-to-lint-ignore — the retired guard opt-out markers become the one marker syntax:
//   @no-server-stack: <reason>          -> kumiko-lint-ignore-file test-stack-drift <reason>
//   @timeout-exception: <reason>        -> kumiko-lint-ignore test-timeouts <reason>
//   @template-drift-exception: <reason> -> kumiko-lint-ignore test-template-drift <reason>
// Only comment lines are touched; the text after the marker stays byte-identical. A reason the
// ignore-tag-reason guard calls too weak is left for the author to rewrite.
//
// Usage:
//   bun scripts/codemod/guard-markers-to-lint-ignore.ts <targetDir...> [--check | --dry-run | --write] [--no-format]
// Without a mode flag it writes (kumiko-upgrade --apply calls it that way). --check exits 1
// while any rewritable site is left; --dry-run only reports.

import { ts } from "ts-morph";
import { type CodemodResult, runCodemodCli, type SiteLists } from "./codemod-support.ts";

const COMMENT_PREFIX = String.raw`(\/\/\s*|\/\*\s*|^\s*\*\s*)`;

interface MarkerRewrite {
  readonly pattern: RegExp;
  readonly replacement: string;
  readonly description: string;
}

const MARKER_REWRITES: readonly MarkerRewrite[] = [
  {
    pattern: new RegExp(`${COMMENT_PREFIX}@no-server-stack:\\s*`),
    replacement: "$1kumiko-lint-ignore-file test-stack-drift ",
    description: "@no-server-stack -> kumiko-lint-ignore-file test-stack-drift",
  },
  {
    pattern: new RegExp(`${COMMENT_PREFIX}@timeout-exception:\\s*`),
    replacement: "$1kumiko-lint-ignore test-timeouts ",
    description: "@timeout-exception -> kumiko-lint-ignore test-timeouts",
  },
  {
    pattern: new RegExp(`${COMMENT_PREFIX}@template-drift-exception:\\s*`),
    replacement: "$1kumiko-lint-ignore test-template-drift ",
    description: "@template-drift-exception -> kumiko-lint-ignore test-template-drift",
  },
];

const CHEAP_PREFILTER = /@(?:no-server-stack|timeout-exception|template-drift-exception):/;

const SKIPPED_PATH_SUFFIXES: readonly string[] = [
  "packages/feature-ast/src/scripts/codemod/guard-markers-to-lint-ignore.ts",
  "packages/feature-ast/src/__tests__/guard-markers-to-lint-ignore-codemod.test.ts",
];

// Leading and trailing trivia of every node cover every comment; string and template contents are tokens, not trivia.
function commentRangesOf(source: string, filePath: string): readonly ts.CommentRange[] {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, false);
  const rangesByStart = new Map<number, ts.CommentRange>();
  const collect = (ranges: readonly ts.CommentRange[] | undefined): void => {
    for (const range of ranges ?? []) rangesByStart.set(range.pos, range);
  };
  const visit = (node: ts.Node): void => {
    collect(ts.getLeadingCommentRanges(source, node.getFullStart()));
    collect(ts.getTrailingCommentRanges(source, node.getEnd()));
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...rangesByStart.values()];
}

function lineAt(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length;
}

export function transformGuardMarkersSource(source: string, filePath: string): CodemodResult {
  const result: SiteLists = { rewrites: [], manual: [] };
  if (!CHEAP_PREFILTER.test(source)) return { output: source, ...result };
  let output = source;
  for (const rewrite of MARKER_REWRITES) {
    const comments = commentRangesOf(output, filePath);
    const current = output;
    output = current.replace(
      new RegExp(rewrite.pattern.source, "gm"),
      (match: string, prefix: string, offset: number) => {
        const markerOffset = offset + prefix.length;
        const insideComment = comments.some(
          (range) => range.pos <= markerOffset && markerOffset < range.end,
        );
        if (!insideComment) return match;
        result.rewrites.push({
          file: filePath,
          line: lineAt(current, markerOffset),
          description: rewrite.description,
        });
        return match.replace(rewrite.pattern, rewrite.replacement);
      },
    );
  }
  result.rewrites.sort((left, right) => left.line - right.line);
  return { output, ...result };
}

function isSkippedPath(file: string): boolean {
  return SKIPPED_PATH_SUFFIXES.some((suffix) => file.endsWith(suffix));
}

if (import.meta.main) {
  await runCodemodCli(
    {
      name: "guard-markers-to-lint-ignore",
      transform: transformGuardMarkersSource,
      isSkippedPath,
      extraExtensions: [".mts"],
    },
    process.argv.slice(2),
  );
}
