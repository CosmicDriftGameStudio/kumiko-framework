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

export function transformGuardMarkersSource(source: string, filePath: string): CodemodResult {
  const result: SiteLists = { rewrites: [], manual: [] };
  if (!CHEAP_PREFILTER.test(source)) return { output: source, ...result };
  const lines = source.split("\n");
  const output = lines.map((line, index) => {
    let rewritten = line;
    for (const rewrite of MARKER_REWRITES) {
      const next = rewritten.replace(rewrite.pattern, rewrite.replacement);
      if (next === rewritten) continue;
      result.rewrites.push({ file: filePath, line: index + 1, description: rewrite.description });
      rewritten = next;
    }
    return rewritten;
  });
  return { output: output.join("\n"), ...result };
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
