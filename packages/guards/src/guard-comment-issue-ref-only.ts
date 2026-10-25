#!/usr/bin/env bun
/**
 * Comment Issue-Ref Guard: a comment that holds only an issue or PR reference or a planning
 * label (`#1234`, `fw#1234`, `Phase 3`, `S2.H1`) and no explanatory word is a violation.
 * The number belongs in the commit message; the comment has to carry the reason. Existing
 * hits are frozen per file in `.kumiko-comment-issue-ref-baseline.json` and may not grow;
 * without a baseline file (consumer repos) the guard only warns.
 *
 * Consecutive own-line `//` comments count as one paragraph, so a reference on the last
 * line of an explaining paragraph is not a hit.
 */

import path from "node:path";
import type { SourceFile } from "ts-morph";
import { COMMENT_KIND_LINE, type CommentTrivia, scanCommentTrivia } from "./_lib/comment-trivia";
import {
  ALL_REPO_KINDS,
  type AstGuard,
  baselineRatchet,
  buildSharedProject,
  filesForGuard,
  isLocalFinding,
  relFromRepoRoot,
  runStandalone,
  type ScanSpec,
} from "./_lib/guard-kit";
import { lineHasIgnoreTag } from "./_lib/ignore-tag";
import { resolveRepoRoots } from "./_lib/roots";

const ROOT = process.cwd();
const GUARD_NAME = "comment-issue-ref-only";
const IGNORE_TAG = "kumiko-lint-ignore comment-issue-ref-only";

const SCAN: ScanSpec = {
  scope: "source",
  kinds: ALL_REPO_KINDS,
  extensions: ["ts", "tsx"],
  frameworkWithin: ["packages/*/src/**"],
};

const EXCLUDE = /(\.d\.(ts|tsx)$|\/dist\/)/;

// `fw#12`, `#1234`, `kumiko-framework#3`, `oven-sh/bun#5`; `&#39;` is an HTML entity.
export const REFERENCE_RE = /(?<!&)[\w./-]*#\d+(?![\w])/g;
// Not preceded by a path/word character and not followed by `/`, `-` or `.ext`, so file names such
// as `round2.ts` or `phase1.sql` are not planning labels, while a sentence-final "Phase 2." is.
const PLANNING_WORD_RE =
  /(?<![\w./-])(?:phase|round|welle|wave|sprint)[- ]?\d+(?:\.\d+)*[a-z]?(?![\w/-]|\.\w)|(?<![\w./-])bug-bash(?:[- ]\d+)?(?![\w/-]|\.\w)/gi;
// Dotted plan labels such as S2.H1, T1.5c, B1.5. Case-sensitive and without V so
// that version numbers (v1.2, V20.1) never count.
const DOTTED_LABEL_RE = /(?<![\w./-])[A-UW-Z]\d{1,2}(?:\.(?:\d+[a-z]?|[A-Z]\d+))+\b/g;
const WORD_RE = /[\p{L}_$][\p{L}\p{N}_$'-]*/gu;
const MIN_EXPLANATORY_WORD_LENGTH = 3;

// Words that only frame a reference ("see #12", "fix for fw#3", "part of Phase 2").
const FRAMING_WORDS: ReadonlySet<string> = new Set([
  "see",
  "siehe",
  "vgl",
  "ref",
  "refs",
  "issue",
  "issues",
  "fix",
  "fixes",
  "fixed",
  "for",
  "from",
  "per",
  "part",
  "the",
  "and",
  "und",
  "via",
  "follow",
  "followup",
  "follow-up",
  "tracking",
  "tracked",
  "todo",
  "fixme",
  "closes",
  "resolves",
  "related",
  "also",
  "nach",
  "aus",
  "laut",
]);

function commentBody(text: string): string {
  return text
    .replace(/^\/\*\*?|\*\/$/g, "")
    .split("\n")
    .map((line) => line.replace(/^\s*(?:\/\/+|\*)?/, ""))
    .join("\n");
}

function referenceTokensIn(body: string): number {
  return (
    (body.match(REFERENCE_RE)?.length ?? 0) +
    (body.match(PLANNING_WORD_RE)?.length ?? 0) +
    (body.match(DOTTED_LABEL_RE)?.length ?? 0)
  );
}

function isExplanatoryWord(word: string): boolean {
  return word.length >= MIN_EXPLANATORY_WORD_LENGTH && !FRAMING_WORDS.has(word.toLowerCase());
}

/** True when the comment carries a reference or planning label and no explanatory word besides it. */
export function isIssueRefOnlyComment(commentText: string): boolean {
  if (lineHasIgnoreTag(commentText, IGNORE_TAG)) return false;
  const body = commentBody(commentText);
  if (referenceTokensIn(body) === 0) return false;
  const rest = body
    .replace(REFERENCE_RE, " ")
    .replace(PLANNING_WORD_RE, " ")
    .replace(DOTTED_LABEL_RE, " ");
  return !(rest.match(WORD_RE) ?? []).some(isExplanatoryWord);
}

type CommentParagraph = { readonly start: number; readonly text: string };

function startsOwnLine(fullText: string, start: number): boolean {
  const lineStart = fullText.lastIndexOf("\n", start - 1) + 1;
  return fullText.slice(lineStart, start).trim() === "";
}

function continuesLineParagraph(
  fullText: string,
  previous: CommentTrivia,
  next: CommentTrivia,
): boolean {
  if (previous.kind !== COMMENT_KIND_LINE || next.kind !== COMMENT_KIND_LINE) return false;
  if (!startsOwnLine(fullText, previous.start) || !startsOwnLine(fullText, next.start))
    return false;
  return /^[ \t]*\r?\n[ \t]*$/.test(
    fullText.slice(previous.start + previous.text.length, next.start),
  );
}

export function commentParagraphs(fullText: string): CommentParagraph[] {
  const paragraphs: CommentParagraph[] = [];
  let current: { start: number; parts: string[]; last: CommentTrivia } | undefined;
  for (const comment of scanCommentTrivia(fullText)) {
    if (current && continuesLineParagraph(fullText, current.last, comment)) {
      current.parts.push(comment.text);
      current.last = comment;
      continue;
    }
    if (current) paragraphs.push({ start: current.start, text: current.parts.join("\n") });
    current = { start: comment.start, parts: [comment.text], last: comment };
  }
  if (current) paragraphs.push({ start: current.start, text: current.parts.join("\n") });
  return paragraphs;
}

export type IssueRefOnlySite = { readonly line: number; readonly text: string };

export function findIssueRefOnlyComments(fullText: string): IssueRefOnlySite[] {
  return commentParagraphs(fullText)
    .filter((paragraph) => isIssueRefOnlyComment(paragraph.text))
    .map((paragraph) => ({
      line: fullText.slice(0, paragraph.start).split("\n").length,
      text: paragraph.text,
    }));
}

export function issueRefOnlyCounts(
  files: readonly SourceFile[],
  roots: ReadonlyArray<{ readonly absPath: string }> = resolveRepoRoots(),
): { counts: Record<string, number>; firstLine: Record<string, number> } {
  const counts: Record<string, number> = {};
  const firstLine: Record<string, number> = {};
  for (const sf of files) {
    if (EXCLUDE.test(sf.getFilePath())) continue;
    const sites = findIssueRefOnlyComments(sf.getFullText());
    const first = sites[0];
    if (first === undefined) continue;
    const file = relFromRepoRoot(sf.getFilePath(), roots);
    if (!isLocalFinding({ file })) continue;
    counts[file] = sites.length;
    firstLine[file] = first.line;
  }
  return { counts, firstLine };
}

const issueRefBaseline = baselineRatchet({
  file: path.join(ROOT, ".kumiko-comment-issue-ref-baseline.json"),
  formatVersion: 1,
  unit: "issue-reference-only comment(s)",
});

const REMEDIATION =
  "Replace the reference with the reason it stands for, or delete the comment; the number belongs in the commit message.";

export const guard: AstGuard = {
  name: GUARD_NAME,
  scan: SCAN,
  hint: `after removing hits: \`kumiko-guards guards --write-baseline --guard=${GUARD_NAME}\`; deliberate exception: // ${IGNORE_TAG} <reason>`,
  run: (files, roots = resolveRepoRoots()) => {
    const { counts, firstLine } = issueRefOnlyCounts(files, roots);
    return {
      violations: issueRefBaseline.check(counts, REMEDIATION, {
        formatDriftRemediation: `Run \`kumiko-guards guards --write-baseline --guard=${GUARD_NAME}\` once.`,
        resolveLine: (file) => firstLine[file] ?? 1,
      }),
    };
  },
  writeBaseline: (files, roots = resolveRepoRoots()) => {
    issueRefBaseline.write(issueRefOnlyCounts(files, roots).counts);
  },
};

if (import.meta.main) {
  if (process.argv.slice(2).includes("--write-baseline")) {
    const project = buildSharedProject([guard]);
    guard.writeBaseline?.(filesForGuard(project, guard));
    process.exit(0);
  }
  runStandalone(guard);
}
