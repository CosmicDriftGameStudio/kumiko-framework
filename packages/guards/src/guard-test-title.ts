#!/usr/bin/env bun
/**
 * Test-title guard: the title of a `test`/`it`/`describe` (including `.each`, `.skip`, `.only`,
 * `.todo` and `.if` chains) is English and carries no issue or PR reference. A German title or one
 * ending in `(#1234)` ages into noise: the number belongs in the commit message, the title has to
 * state the behaviour. Existing hits are frozen per file in `.kumiko-test-title-baseline.json` and
 * may not grow; without a baseline file (consumer repos) the guard only warns.
 */

import path from "node:path";
import { type CallExpression, Node, type SourceFile, SyntaxKind } from "ts-morph";
import { isGermanTestTitle } from "./_lib/german-test-title";
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
import { hasIgnoreTag } from "./_lib/ignore-tag";
import { resolveRepoRoots } from "./_lib/roots";
import {
  canonicalCalleeText,
  declarationBaseCallee,
  TEST_DECLARATION_CALLEE,
  testFrameworkAliases,
} from "./_lib/test-callee";
import { REFERENCE_RE } from "./guard-comment-issue-ref-only";

const ROOT = process.cwd();
const GUARD_NAME = "test-title";
const IGNORE_TAG = `kumiko-lint-ignore ${GUARD_NAME}`;

// Playwright specs sit outside every manifest's testGlobs; so do bin and sample-app tests.
const SCAN: ScanSpec = {
  scope: "tests",
  kinds: ALL_REPO_KINDS,
  extensions: ["ts", "tsx"],
  extraGlobs: [
    "packages/*/src/**/__tests__/**/*.{ts,tsx}",
    "packages/*/bin/**/__tests__/**/*.{ts,tsx}",
    "samples/apps/**/*.{test,spec}.{ts,tsx}",
    "samples/apps/**/__tests__/**/*.{ts,tsx}",
    "e2e/**/*.{ts,tsx}",
    "packages/*/e2e/**/*.{ts,tsx}",
    "packages/*/src/e2e/**/*.{ts,tsx}",
    "samples/e2e/**/*.{ts,tsx}",
    "samples/recipes/*/e2e/**/*.{ts,tsx}",
    "samples/apps/*/e2e/**/*.{ts,tsx}",
  ],
};

const EXCLUDE = /(\.d\.(ts|tsx)$|\/dist\/)/;
const PLAYWRIGHT_DESCRIBE_CALLEE = /^test\.(describe|fixme|fail)(\.\w+)*$/;

type TitleFinding = { readonly line: number; readonly title: string; readonly reason: string };

export function hasIssueReference(title: string): boolean {
  return (title.match(REFERENCE_RE)?.length ?? 0) > 0;
}

function titleReason(title: string): string | undefined {
  if (isGermanTestTitle(title)) return "German";
  if (hasIssueReference(title)) return "issue reference";
  return undefined;
}

function isTitleLiteral(arg: Node): boolean {
  return (
    Node.isStringLiteral(arg) ||
    Node.isNoSubstitutionTemplateLiteral(arg) ||
    Node.isTemplateExpression(arg)
  );
}

function titleLiteralText(arg: Node | undefined): string | undefined {
  if (arg === undefined || !isTitleLiteral(arg)) return undefined;
  return arg.getText().slice(1, -1);
}

function isTestDeclaration(call: CallExpression, aliases: ReadonlyMap<string, string>): boolean {
  const base = canonicalCalleeText(declarationBaseCallee(call.getExpression()).getText(), aliases);
  return TEST_DECLARATION_CALLEE.test(base) || PLAYWRIGHT_DESCRIBE_CALLEE.test(base);
}

export function findBadTestTitles(sf: SourceFile): TitleFinding[] {
  const aliases = testFrameworkAliases(sf);
  const findings: TitleFinding[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!isTestDeclaration(call, aliases)) continue;
    const arg = call.getArguments()[0];
    const title = titleLiteralText(arg);
    if (arg === undefined || title === undefined) continue;
    const reason = titleReason(title);
    if (reason === undefined) continue;
    if (hasIgnoreTag(arg, IGNORE_TAG) || hasIgnoreTag(call, IGNORE_TAG)) continue;
    findings.push({ line: arg.getStartLineNumber(), title, reason });
  }
  return findings.sort((a, b) => a.line - b.line);
}

export function testTitleCounts(
  files: readonly SourceFile[],
  roots: ReadonlyArray<{ readonly absPath: string }> = resolveRepoRoots(),
): { counts: Record<string, number>; firstLine: Record<string, number> } {
  const counts: Record<string, number> = {};
  const firstLine: Record<string, number> = {};
  for (const sf of files) {
    if (EXCLUDE.test(sf.getFilePath())) continue;
    const findings = findBadTestTitles(sf);
    const first = findings[0];
    if (first === undefined) continue;
    const file = relFromRepoRoot(sf.getFilePath(), roots);
    if (!isLocalFinding({ file })) continue;
    counts[file] = findings.length;
    firstLine[file] = first.line;
  }
  return { counts, firstLine };
}

const testTitleBaseline = baselineRatchet({
  file: path.join(ROOT, ".kumiko-test-title-baseline.json"),
  formatVersion: 1,
  unit: "German or issue-referencing test title(s)",
});

const REMEDIATION =
  "Write the title in English and state the behaviour instead of the issue number; the number belongs in the commit message.";

export const guard: AstGuard = {
  name: GUARD_NAME,
  scan: SCAN,
  hint: `after fixing hits: \`kumiko-guards guards --write-baseline --guard=${GUARD_NAME}\`; deliberate exception (e.g. a German fixture string): // ${IGNORE_TAG} <reason>`,
  run: (files, roots = resolveRepoRoots()) => {
    const { counts, firstLine } = testTitleCounts(files, roots);
    return {
      violations: testTitleBaseline.check(counts, REMEDIATION, {
        formatDriftRemediation: `Run \`kumiko-guards guards --write-baseline --guard=${GUARD_NAME}\` once.`,
        resolveLine: (file) => firstLine[file] ?? 1,
      }),
    };
  },
  writeBaseline: (files, roots = resolveRepoRoots()) => {
    testTitleBaseline.write(testTitleCounts(files, roots).counts);
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
