#!/usr/bin/env bun
// The single-file guards moved to Biome (preset `@cosmicdrift/kumiko-framework/biome-rules`), so
// their `kumiko-lint-ignore <slug> <reason>` markers turn into `biome-ignore <rule>: <reason>`.
// Only slugs of deleted guards are touched; slugs of surviving guards (complexity-budget,
// cross-feature-import, ...) stay as they are. The comment form (`//`, `/* */`, `{/* */}`) and the
// reason are kept verbatim; a marker without a reason of at least three words is listed, never
// converted, because a reason is not invented here.
//
// Usage: bun scripts/codemod/lint-ignore-to-biome.ts <targetDir> [--check | --dry-run]

import { ts } from "ts-morph";
import {
  type CodemodCliConfig,
  type CodemodResult,
  type CodemodSite,
  runCodemod,
} from "./codemod-support.ts";

const MIN_REASON_WORDS = 3;

const PLUGIN_RULE = "lint/plugin";
const INLINE_STYLES_RULE = "lint/style/noInlineStyles";

// Slugs of the guards deleted in the guards-to-biome move; each maps to the rule that replaces it.
const DELETED_GUARD_SLUG_RULES: ReadonlyMap<string, string> = new Map([
  ["direct-fetch", PLUGIN_RULE],
  ["direct-fs", PLUGIN_RULE],
  ["i18n-locale-terminology", PLUGIN_RULE],
  ["no-custom-primitives", PLUGIN_RULE],
  ["no-inline-styles", INLINE_STYLES_RULE],
  ["no-raw-hooks", PLUGIN_RULE],
  ["primitives-discipline", PLUGIN_RULE],
  ["raw-classname", PLUGIN_RULE],
  ["raw-interactive-elements", PLUGIN_RULE],
  ["test-title", PLUGIN_RULE],
]);

// Mirrors the includes of no-raw-hooks.grit in presets/biome-rules.json: outside them a converted
// marker would be a `biome-ignore` that suppresses nothing, which Biome reports as unused.
const NO_RAW_HOOKS_SCOPE = /\/(web|public)\/.*\.tsx$/;
const NO_RAW_HOOKS_EXCLUDED =
  /\/__tests__\/|\.(test|integration)\.tsx$|\/packages\/(renderer|document-designer)\/|\/samples\//;

function isPluginScopeOfSlug(slug: string, file: string): boolean {
  if (slug !== "no-raw-hooks") return true;
  const path = `/${file}`;
  return NO_RAW_HOOKS_SCOPE.test(path) && !NO_RAW_HOOKS_EXCLUDED.test(path);
}

const MARKER_RE = /^\s*\**\s*kumiko-lint-ignore\s+([\w-]+(?:,[\w-]+)*)(?:\s+([\s\S]*))?$/;

type CommentRange = { readonly pos: number; readonly end: number; readonly line: number };

function scriptKindFor(file: string): ts.ScriptKind {
  return file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

/** Real comments only: JSX text and string literals that merely look like comments are skipped. */
function collectComments(sourceFile: ts.SourceFile): CommentRange[] {
  const text = sourceFile.text;
  const seen = new Map<number, CommentRange>();
  const addRanges = (ranges: readonly ts.CommentRange[] | undefined): void => {
    for (const range of ranges ?? []) {
      const line = sourceFile.getLineAndCharacterOfPosition(range.pos).line + 1;
      seen.set(range.pos, { pos: range.pos, end: range.end, line });
    }
  };
  const visit = (node: ts.Node): void => {
    addRanges(ts.getLeadingCommentRanges(text, node.getFullStart()));
    addRanges(ts.getTrailingCommentRanges(text, node.getEnd()));
    for (const child of node.getChildren(sourceFile)) visit(child);
  };
  visit(sourceFile);
  return [...seen.values()].sort((a, b) => a.pos - b.pos);
}

function reasonWordCount(reason: string): number {
  return reason.split(/\s+/).filter((word) => word.length > 0).length;
}

type Rewrite =
  | { readonly kind: "converted"; readonly replacement: string }
  | { readonly kind: "unconverted"; readonly note: string }
  | { readonly kind: "untouched" };

function rewriteComment(commentText: string, file: string): Rewrite {
  const isBlock = commentText.startsWith("/*");
  const body = isBlock ? commentText.slice(2, -2) : commentText.slice(2);
  const match = MARKER_RE.exec(body);
  if (!match) {
    return /kumiko-lint-ignore\s+[\w-]/.test(body) && mentionsDeletedSlug(body)
      ? {
          kind: "unconverted",
          note: "marker does not start the comment, convert it by hand",
        }
      : { kind: "untouched" };
  }
  const slugs = (match[1] ?? "").split(",");
  const deleted = slugs.filter(
    (slug) => DELETED_GUARD_SLUG_RULES.has(slug) && isPluginScopeOfSlug(slug, file),
  );
  if (deleted.length === 0) return { kind: "untouched" };

  const rules = new Set(deleted.map((slug) => DELETED_GUARD_SLUG_RULES.get(slug)));
  if (deleted.length !== slugs.length || rules.size !== 1) {
    return {
      kind: "unconverted",
      note: `slug list "${slugs.join(",")}" mixes surviving guards or several Biome rules, split it by hand`,
    };
  }
  const reason = (match[2] ?? "").replace(/\s+/g, " ").trim();
  if (reasonWordCount(reason) < MIN_REASON_WORDS) {
    return {
      kind: "unconverted",
      note: `reason "${reason}" has fewer than ${MIN_REASON_WORDS} words, add a real reason by hand`,
    };
  }
  const [rule] = rules;
  const suppression = `biome-ignore ${rule}: ${reason}`;
  return {
    kind: "converted",
    replacement: isBlock ? `/* ${suppression} */` : `// ${suppression}`,
  };
}

function mentionsDeletedSlug(body: string): boolean {
  return [...DELETED_GUARD_SLUG_RULES.keys()].some((slug) => body.includes(slug));
}

function migrateLintIgnoreMarkers(text: string, file: string): CodemodResult {
  const rewrites: CodemodSite[] = [];
  const manual: CodemodSite[] = [];
  if (!text.includes("kumiko-lint-ignore")) return { output: text, rewrites, manual };
  const sourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(file),
  );
  let output = text;
  for (const comment of collectComments(sourceFile).reverse()) {
    const rewrite = rewriteComment(text.slice(comment.pos, comment.end), file);
    if (rewrite.kind === "untouched") continue;
    if (rewrite.kind === "unconverted") {
      manual.push({ file, line: comment.line, description: rewrite.note });
      continue;
    }
    output = output.slice(0, comment.pos) + rewrite.replacement + output.slice(comment.end);
    rewrites.push({ file, line: comment.line, description: rewrite.replacement });
  }
  return { output, rewrites: rewrites.reverse(), manual: manual.reverse() };
}

export const lintIgnoreToBiomeCodemod: CodemodCliConfig = {
  name: "lint-ignore-to-biome",
  transform: migrateLintIgnoreMarkers,
  isSkippedPath: () => false,
  extraExtensions: [".mts", ".cts"],
};

if (import.meta.main) {
  const exitCode = await runCodemod(lintIgnoreToBiomeCodemod, process.argv.slice(2));
  console.log(
    "\nNote: each marker was converted where it stood. Biome applies a suppression only to the next line or node, " +
      "while the old marker could sit several lines above its hit (and a trailing comment is not honoured at all). " +
      "Run `biome lint` afterwards and move the remaining ones by hand.\n",
  );
  process.exit(exitCode);
}
