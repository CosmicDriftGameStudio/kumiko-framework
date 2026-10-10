import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { ts } from "ts-morph";
import { gitEnv } from "./_lib/git-env";
import { cliFlagsError, isLocalFinding } from "./_lib/guard-kit";
import { lineHasIgnoreTag } from "./_lib/ignore-tag";
import { resolveRepoRoots } from "./_lib/roots";
import { type ScanSpec, scanFiles } from "./_lib/scan-scope";

// Comment-language ratchet: no new German comments in product code. No NLP —
// German markers are common function words or umlaut characters in the comment text.
// Baseline mode compares per-file counts against a frozen file (more than the
// baseline fails, fewer is allowed but does not rewrite it); `--touched` fails
// on any German comment that overlaps a line added since `--base`.

export const COMMENT_LANG_FLAGS: readonly string[] = [
  "--touched",
  "--list",
  "--write-baseline",
  "--no-baseline",
];

const BASE_FLAG_PREFIX = "--base=";
const BASELINE_FILE = ".kumiko-comment-lang-baseline.json";
const BASELINE_FORMAT_VERSION = 1;
const LIST_LIMIT = 200;
const IGNORE_TAG = "kumiko-lint-ignore comment-lang";

const SCAN: ScanSpec = {
  scope: "source",
  extensions: ["ts", "tsx"],
  frameworkWithin: ["packages/*/src/**"],
};

const EXCLUDE = /(\.d\.(ts|tsx)$|\/dist\/)/;

const DE_MARKER_RE =
  /\b(und|oder|für|wenn|nicht|dann|auch|noch|wird|sind|mit|zum|zur|bei|nach|ohne|über|kein|eine|einen|dieser|diese)\b/i;
const UMLAUT_RE = /[äöüÄÖÜß]/;

export function isGermanComment(text: string): boolean {
  return DE_MARKER_RE.test(text) || UMLAUT_RE.test(text);
}

export type Site = {
  readonly file: string;
  readonly line: number;
  /** Last line of a multi-line comment: touched mode must catch a German sentence added mid-comment, not only on the opening line. */
  readonly endLine: number;
  readonly snippet: string;
};

function germanCommentSite(
  fullText: string,
  file: string,
  start: number,
  text: string,
): Site | undefined {
  if (lineHasIgnoreTag(text, IGNORE_TAG) || !isGermanComment(text)) return undefined;
  const line = fullText.slice(0, start).split("\n").length;
  return {
    file,
    line,
    endLine: line + (text.match(/\n/g)?.length ?? 0),
    snippet: text.length > 80 ? `${text.slice(0, 77)}...` : text,
  };
}

function closesTemplateSubstitution(
  templateBraceDepths: readonly number[],
  braceDepth: number,
): boolean {
  return (
    templateBraceDepths.length > 0 &&
    braceDepth === templateBraceDepths[templateBraceDepths.length - 1]
  );
}

// Template substitutions can nest braces (object literals, arrow bodies, other
// templates). The raw scanner tokenizes a `}` as a plain CloseBraceToken and
// never resumes template mode, so reScanTemplateToken() must run once brace
// depth returns to the level the substitution opened at.
export function scanGermanComments(fullText: string, file: string): Site[] {
  const sites: Site[] = [];
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    /* skipTrivia */ false,
    ts.LanguageVariant.Standard,
    fullText,
  );

  const templateBraceDepths: number[] = [];
  let braceDepth = 0;

  let kind = scanner.scan();
  while (kind !== ts.SyntaxKind.EndOfFileToken) {
    switch (kind) {
      case ts.SyntaxKind.SingleLineCommentTrivia:
      case ts.SyntaxKind.MultiLineCommentTrivia: {
        const site = germanCommentSite(
          fullText,
          file,
          scanner.getTokenStart(),
          scanner.getTokenText(),
        );
        if (site) sites.push(site);
        break;
      }
      case ts.SyntaxKind.SlashToken:
      case ts.SyntaxKind.SlashEqualsToken: {
        // The raw scanner always yields SlashToken for `/`; without the rescan a
        // regex body like /\{/ would shift braceDepth and end a template early.
        const reScanned = scanner.reScanSlashToken();
        if (reScanned === ts.SyntaxKind.RegularExpressionLiteral) kind = reScanned;
        break;
      }
      case ts.SyntaxKind.TemplateHead:
      case ts.SyntaxKind.TemplateMiddle:
        templateBraceDepths.push(braceDepth);
        break;
      case ts.SyntaxKind.OpenBraceToken:
        braceDepth++;
        break;
      case ts.SyntaxKind.CloseBraceToken:
        if (closesTemplateSubstitution(templateBraceDepths, braceDepth)) {
          templateBraceDepths.pop();
          kind = scanner.reScanTemplateToken(false);
          continue;
        }
        if (braceDepth > 0) braceDepth--;
        break;
      default:
        break;
    }
    kind = scanner.scan();
  }
  return sites;
}

// `--unified=0` hunks carry only changed lines, so `+newStart,newLines` alone
// is the added range. `newLines` omitted means 1; `,0` is a pure deletion.
export function parseAddedLineRanges(diffText: string): Set<number> {
  const added = new Set<number>();
  const hunkHeaderRe = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
  for (const line of diffText.split("\n")) {
    const match = hunkHeaderRe.exec(line);
    if (!match) continue;
    const newStart = Number(match[1]);
    const newLines = match[2] !== undefined ? Number(match[2]) : 1;
    for (let i = 0; i < newLines; i++) added.add(newStart + i);
  }
  return added;
}

export function sitesTouchedByAddedLines(
  sites: readonly Site[],
  addedLines: ReadonlySet<number>,
): Site[] {
  return sites.filter((site) => {
    for (let line = site.line; line <= site.endLine; line++) {
      if (addedLines.has(line)) return true;
    }
    return false;
  });
}

type GitResult = { readonly exitCode: number; readonly stdout: string; readonly stderr: string };

function runGit(args: readonly string[], cwd: string): GitResult {
  const proc = Bun.spawnSync(["git", ...args], {
    cwd,
    env: gitEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: proc.exitCode ?? 1,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

class CommentLangFailure extends Error {}

function gitOrFail(args: readonly string[], cwd: string, message: string): string {
  const result = runGit(args, cwd);
  if (result.exitCode !== 0)
    throw new CommentLangFailure(`${message}\n    ${result.stderr.trim()}`);
  return result.stdout;
}

const REWRITE_HINT = `Translate new German comments to English (why, not what), or if deliberate:\n    // ${IGNORE_TAG} <reason>`;

function runTouchedMode(
  all: readonly Site[],
  argv: readonly string[],
  root: string,
  repoLocalScannedFiles: number,
): number {
  const baseArg = argv.find((arg) => arg.startsWith(BASE_FLAG_PREFIX));
  const baseRef = baseArg ? baseArg.slice(BASE_FLAG_PREFIX.length) : "origin/main";
  if (baseRef.startsWith("-")) {
    throw new CommentLangFailure(
      `--base must not start with "-" (${baseRef}): it would be read as a git option, not a ref.`,
    );
  }

  // No repo-local file scanned at all must not read as clean (vacuous pass).
  if (repoLocalScannedFiles === 0) {
    console.log("  Touched mode: 0 repo-local files scanned — not applicable, no failure.");
    return 0;
  }

  const gitToplevel = gitOrFail(
    ["rev-parse", "--show-toplevel"],
    root,
    "Touched mode: no git repository found.",
  ).trim();
  const mergeBase = gitOrFail(
    ["merge-base", baseRef, "HEAD"],
    gitToplevel,
    `Touched mode: git merge-base ${baseRef} HEAD failed — is ${baseRef} known locally? On shallow checkouts fetch the full history or the ref.`,
  ).trim();
  // -z: NUL-terminated and unquoted, so non-ASCII paths still match the lookup below.
  const touchedFiles = gitOrFail(
    ["diff", "--name-only", "-z", "--diff-filter=ACMR", mergeBase],
    gitToplevel,
    "Touched mode: git diff --name-only failed.",
  )
    .split("\0")
    .filter(Boolean);

  // Sites are keyed relative to root, git output relative to the toplevel;
  // a silent mismatch would read as "no violations".
  const sitesByGitFile = new Map<string, Site[]>();
  for (const site of all.filter(isLocalFinding)) {
    const gitRelPath = path.relative(gitToplevel, path.resolve(root, site.file));
    sitesByGitFile.set(gitRelPath, [...(sitesByGitFile.get(gitRelPath) ?? []), site]);
  }

  const violations: Array<{ file: string; sites: Site[] }> = [];
  for (const file of touchedFiles) {
    const candidates = sitesByGitFile.get(file);
    if (!candidates || candidates.length === 0) continue;
    // --literal-pathspecs: filenames with glob magic must match themselves.
    const addedLines = parseAddedLineRanges(
      gitOrFail(
        ["--literal-pathspecs", "diff", "--unified=0", mergeBase, "--", file],
        gitToplevel,
        `Touched mode: git diff --unified=0 failed for ${file}.`,
      ),
    );
    const touchedSites = sitesTouchedByAddedLines(candidates, addedLines);
    if (touchedSites.length > 0) violations.push({ file, sites: touchedSites });
  }

  if (violations.length === 0) {
    console.log(
      `  ✓ Touched mode: no new German comments in ${touchedFiles.length} changed file(s) since ${baseRef}.`,
    );
    return 0;
  }
  console.log(
    `\n  TOUCHED-MODE REGRESSION: ${violations.length} changed file(s) with new German comments (since ${baseRef}):`,
  );
  for (const violation of violations) {
    console.log(`    ${violation.file}`);
    for (const site of violation.sites) console.log(`      :${site.line}  ${site.snippet}`);
  }
  console.log(`\n  ${REWRITE_HINT}`);
  return 1;
}

type Baseline = {
  readonly format: number;
  readonly generated: string;
  readonly total: number;
  readonly perFile: Record<string, number>;
};

function sumCounts(counts: Readonly<Record<string, number>>): number {
  return Object.values(counts).reduce((total, count) => total + count, 0);
}

function isBaselineCandidate(value: unknown): value is Partial<Baseline> {
  return typeof value === "object" && value !== null;
}

function hasPerFileObject(baseline: Partial<Baseline>): baseline is Partial<Baseline> & {
  readonly perFile: Record<string, number>;
} {
  return typeof baseline.perFile === "object" && baseline.perFile !== null;
}

function countFindingsByFile(all: readonly Site[]): Record<string, number> {
  const countByFile: Record<string, number> = {};
  for (const site of all.filter(isLocalFinding)) {
    countByFile[site.file] = (countByFile[site.file] ?? 0) + 1;
  }
  return countByFile;
}

function writeBaselineFile(
  baselinePath: string,
  countByFile: Readonly<Record<string, number>>,
  currentTotal: number,
): void {
  const payload: Baseline = {
    format: BASELINE_FORMAT_VERSION,
    generated: Temporal.Now.instant().toString().slice(0, 10),
    total: currentTotal,
    perFile: Object.fromEntries(Object.entries(countByFile).sort(([a], [b]) => a.localeCompare(b))),
  };
  writeFileSync(baselinePath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`  Baseline written: ${baselinePath} (total ${currentTotal})`);
}

type LoadedBaseline = Partial<Baseline> & { readonly perFile: Record<string, number> };

// Prints the diagnosis itself and returns undefined when the baseline cannot be used.
function readBaselineOrReport(baselinePath: string): LoadedBaseline | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(baselinePath, "utf-8"));
  } catch (error) {
    console.log(
      `  Baseline unreadable: ${error instanceof Error ? error.message : String(error)}. Rewrite it once with: kumiko-guards comment-lang --write-baseline`,
    );
    return undefined;
  }
  // JSON `null`, numbers and strings parse fine but carry no baseline: report them as format drift.
  const rawBaseline: Partial<Baseline> = isBaselineCandidate(parsed) ? parsed : {};
  if (rawBaseline.format !== BASELINE_FORMAT_VERSION || !hasPerFileObject(rawBaseline)) {
    console.log(
      `  Baseline format drift: expected format=${BASELINE_FORMAT_VERSION}, got format=${rawBaseline.format ?? "<missing>"}.`,
    );
    console.log("  Rewrite it once with: kumiko-guards comment-lang --write-baseline");
    return undefined;
  }
  return rawBaseline;
}

type BaselineRegression = { file: string; baseline: number; current: number };

function compareCountsToBaseline(
  countByFile: Readonly<Record<string, number>>,
  baselinePerFile: Readonly<Record<string, number>>,
): { regressions: BaselineRegression[]; reduced: number } {
  const regressions: BaselineRegression[] = [];
  let reduced = 0;
  for (const file of new Set([...Object.keys(countByFile), ...Object.keys(baselinePerFile)])) {
    const expected = baselinePerFile[file] ?? 0;
    const current = countByFile[file] ?? 0;
    if (current > expected) regressions.push({ file, baseline: expected, current });
    else if (current < expected) reduced += expected - current;
  }
  return { regressions, reduced };
}

function printRegressions(all: readonly Site[], regressions: readonly BaselineRegression[]): void {
  console.log(
    `\n  REGRESSION: ${regressions.length} file(s) have more German comments than the baseline:`,
  );
  for (const regression of regressions) {
    console.log(
      `    ${regression.file}  baseline=${regression.baseline} current=${regression.current} (+${regression.current - regression.baseline})`,
    );
    for (const site of all.filter((candidate) => candidate.file === regression.file)) {
      console.log(`      :${site.line}  ${site.snippet}`);
    }
  }
  console.log(`\n  ${REWRITE_HINT}`);
}

function runBaselineMode(all: readonly Site[], argv: readonly string[], root: string): number {
  const baselinePath = path.join(root, BASELINE_FILE);
  const countByFile = countFindingsByFile(all);
  const currentTotal = sumCounts(countByFile);

  if (argv.includes("--write-baseline")) {
    writeBaselineFile(baselinePath, countByFile, currentTotal);
    return 0;
  }
  if (argv.includes("--no-baseline")) {
    console.log("  Baseline comparison skipped (--no-baseline).");
    return 0;
  }
  if (!existsSync(baselinePath)) {
    console.log("  No baseline found. Freeze one first with `--write-baseline`.");
    return 1;
  }

  const baseline = readBaselineOrReport(baselinePath);
  if (baseline === undefined) return 1;

  const { regressions, reduced } = compareCountsToBaseline(countByFile, baseline.perFile);
  if (regressions.length > 0) {
    printRegressions(all, regressions);
    return 1;
  }

  console.log(`  ✓ Baseline (${baseline.total}) — current ${currentTotal}`);
  if (reduced > 0) {
    console.log(
      `  ✓ ${reduced} German comment(s) removed since the baseline. Consider \`--write-baseline\`.`,
    );
  }
  return 0;
}

// `cwd` resolves the repo to scan and the baseline path; KUMIKO_PUSH_REPO_ROOT
// overrides it because the pre-push hook cds into the parent workspace first.
export function runCommentLangCli(
  argv: readonly string[],
  cwd: string = process.cwd(),
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const knownFlags = argv.filter((arg) => !arg.startsWith(BASE_FLAG_PREFIX));
  const flagsError = cliFlagsError("comment-lang", knownFlags, COMMENT_LANG_FLAGS);
  if (flagsError !== undefined) {
    console.error(flagsError);
    return 1;
  }

  const pushRoot = env["KUMIKO_PUSH_REPO_ROOT"];
  const root = pushRoot && existsSync(pushRoot) ? pushRoot : cwd;

  try {
    const all: Site[] = [];
    let scanned = 0;
    let repoLocalScanned = 0;
    for (const absPath of scanFiles(SCAN, resolveRepoRoots(root))) {
      if (EXCLUDE.test(absPath)) continue;
      scanned++;
      const file = path.relative(root, absPath);
      if (isLocalFinding({ file })) repoLocalScanned++;
      all.push(...scanGermanComments(readFileSync(absPath, "utf-8"), file));
    }

    // Zero scanned files must not read as a clean pass (misresolved root, empty scope).
    if (scanned === 0) {
      throw new CommentLangFailure("Scanned 0 files — repo root or scan scope did not resolve.");
    }

    console.log(
      `Comment-Language Audit: ${scanned} files checked, ${all.length} German comment(s) found.`,
    );

    if (argv.includes("--touched")) return runTouchedMode(all, argv, root, repoLocalScanned);
    if (argv.includes("--list")) {
      for (const site of all.slice(0, LIST_LIMIT)) {
        console.log(`  ${site.file}:${site.line}  ${site.snippet}`);
      }
      if (all.length > LIST_LIMIT) console.log(`  ... (${all.length - LIST_LIMIT} more)`);
      return 0;
    }
    return runBaselineMode(all, argv, root);
  } catch (error) {
    if (error instanceof CommentLangFailure) {
      console.log(`  ${error.message}`);
      return 1;
    }
    throw error;
  }
}
