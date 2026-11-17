#!/usr/bin/env bun
/**
 * Weak-Assertions Guard — tests whose only assertions are `expect(x).toBeDefined()` or `expect(x).toBeTruthy()` are counted per file in `.kumiko-weak-assertions-baseline.json` and may not grow; such a test passes for any value that happens to exist. A missing baseline file counts as an empty baseline, so every existing hit fails until it is frozen with `--write-baseline`.
 *
 * A test counts when it has at least one expect() matcher, every matcher is a bare
 * toBeDefined/toBeTruthy (no `.not`, `.resolves` or `.rejects`), and nothing else in
 * its body asserts: no writeOk/writeErr/queryOk/queryErr, assertion helper, Testing
 * Library getBy/findBy query or same-file helper that asserts.
 *
 * Usage (framework dev checkout):
 *   bun guards/guard-weak-assertions.ts
 * Consumer (via the published `kumiko-guards` CLI):
 *   kumiko-guards guards --guard=weak-assertions
 */

import path from "node:path";
import { type CallExpression, type Node, type SourceFile, SyntaxKind } from "ts-morph";
import {
  type AstGuard,
  baselineRatchet,
  buildSharedProject,
  filesForGuard,
  isLocalFinding,
  relFromRepoRoot,
  runStandalone,
  type ScanSpec,
} from "./_lib/guard-kit";
import { resolveRepoRoots } from "./_lib/roots";
import { testFrameworkAliases } from "./_lib/test-callee";
import {
  bodyHasAssertion,
  isDirectAssertionCall,
  isExpectCall,
  isTestCall,
  resolveSameFileHelper,
} from "./guard-fake-tests";

const ROOT = process.cwd();

const SCAN: ScanSpec = {
  scope: "tests",
  extensions: ["ts", "tsx"],
  kinds: ["framework", "library", "app"],
};

const WEAK_MATCHERS: ReadonlySet<string> = new Set(["toBeDefined", "toBeTruthy"]);

const weakAssertionsBaseline = baselineRatchet({
  file: path.join(ROOT, ".kumiko-weak-assertions-baseline.json"),
  formatVersion: 1,
  unit: "weak-assertion test(s)",
});

type MatcherStrength = "weak" | "strong";

function expectChainRoot(node: Node): Node {
  return node.isKind(SyntaxKind.PropertyAccessExpression)
    ? expectChainRoot(node.getExpression())
    : node;
}

// Any matcher behind a modifier (`.not`, `.resolves`, `.rejects`) counts as strong.
function matcherStrength(call: CallExpression): MatcherStrength | undefined {
  const matcher = call.getExpression();
  if (!matcher.isKind(SyntaxKind.PropertyAccessExpression)) return undefined;
  const target = matcher.getExpression();
  if (isExpectCall(target)) return WEAK_MATCHERS.has(matcher.getName()) ? "weak" : "strong";
  return isExpectCall(expectChainRoot(target)) ? "strong" : undefined;
}

function callsAssertingHelper(call: CallExpression, sf: SourceFile): boolean {
  const callee = call.getExpression();
  if (!callee.isKind(SyntaxKind.Identifier)) return false;
  const helper = resolveSameFileHelper(sf, callee);
  return helper !== undefined && bodyHasAssertion(helper, sf, 1, new Map());
}

function isWeakAssertionTest(body: Node, sf: SourceFile): boolean {
  let weakMatchers = 0;
  for (const call of body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const strength = matcherStrength(call);
    if (strength === "strong") return false;
    if (strength === "weak") {
      weakMatchers++;
      continue;
    }
    // the inner expect(x) of a matcher chain, already classified through its matcher
    if (isExpectCall(call)) continue;
    if (isDirectAssertionCall(call) || callsAssertingHelper(call, sf)) return false;
  }
  return weakMatchers > 0;
}

function countWeakAssertionTests(sf: SourceFile): number {
  const aliases = testFrameworkAliases(sf);
  let count = 0;
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!isTestCall(call, aliases)) continue;
    const body = call.getArguments()[1];
    if (body === undefined) continue;
    if (!body.isKind(SyntaxKind.ArrowFunction) && !body.isKind(SyntaxKind.FunctionExpression)) {
      continue;
    }
    if (isWeakAssertionTest(body, sf)) count++;
  }
  return count;
}

export function weakAssertionTestCounts(
  files: readonly SourceFile[],
  roots: ReadonlyArray<{ readonly absPath: string }> = resolveRepoRoots(),
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const sf of files) {
    const count = countWeakAssertionTests(sf);
    if (count === 0) continue;
    counts[relFromRepoRoot(sf.getFilePath(), roots)] = count;
  }
  return counts;
}

function localOnly(counts: Readonly<Record<string, number>>): Record<string, number> {
  return Object.fromEntries(Object.entries(counts).filter(([file]) => isLocalFinding({ file })));
}

const REMEDIATION =
  "Assert the expected value (toBe, toEqual, toMatchObject, toContain) instead of only its existence; do not grow a frozen file.";

export const guard: AstGuard = {
  name: "weak-assertions",
  scan: SCAN,
  hint: 'after a deliberate change: `kumiko-guards guards --write-baseline --guard="weak-assertions"`',
  run: (files, roots = resolveRepoRoots()) => {
    const counts = localOnly(weakAssertionTestCounts(files, roots));
    return {
      violations: weakAssertionsBaseline.check(counts, REMEDIATION, {
        formatDriftRemediation: `Run \`kumiko-guards guards --write-baseline --guard="weak-assertions"\` once.`,
      }),
    };
  },
  writeBaseline: (files, roots = resolveRepoRoots()) => {
    weakAssertionsBaseline.write(localOnly(weakAssertionTestCounts(files, roots)));
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
