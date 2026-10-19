#!/usr/bin/env bun
/**
 * Guard: reports `ctx.unsafeAppendEvent` (also `ctx["unsafeAppendEvent"]` and destructuring) outside `migrations/`, `upcasters/` and tests.
 *
 * `appendEvent` is the typed default, `tryAppendEvent` the optimistic variant. The untyped
 * `unsafeAppendEvent` skips payload typing and is meant for migrations and upcasters, where the
 * event type is not knowable at compile time.
 *
 * Existing call sites are frozen per file in `.kumiko-unsafe-append-event-baseline.json`; a count
 * over the baseline fails, at or under passes. Without the file (consumer repos) the guard only
 * warns.
 *
 * Usage:
 *   bun packages/guards/src/guard-unsafe-append-event.ts                  # compare to baseline
 *   bun packages/guards/src/guard-unsafe-append-event.ts --write-baseline # freeze current
 */

import * as path from "node:path";

import { Node, type SourceFile, SyntaxKind } from "ts-morph";
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
import { resolveRepoRoots } from "./_lib/roots";

const SCAN: ScanSpec = {
  kinds: ALL_REPO_KINDS,
  scope: "source",
  extensions: ["ts"],
  frameworkWithin: ["packages/*/src/**", "samples/**"],
};

const SYMBOL = "unsafeAppendEvent";
const ALLOWED_PATH = /(^|\/)(migrations|upcasters|__tests__)\/|\.test\.ts$|\.d\.ts$/;

function unsafeAppendEventLines(sf: SourceFile): number[] {
  const propertyAccesses = sf
    .getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)
    .filter((access) => access.getNameNode().getText() === SYMBOL);
  const elementAccesses = sf
    .getDescendantsOfKind(SyntaxKind.ElementAccessExpression)
    .filter((access) => {
      const argument = access.getArgumentExpression();
      return (
        argument !== undefined &&
        (Node.isStringLiteral(argument) || Node.isNoSubstitutionTemplateLiteral(argument)) &&
        argument.getLiteralText() === SYMBOL
      );
    });
  const destructurings = sf
    .getDescendantsOfKind(SyntaxKind.BindingElement)
    .filter(
      (element) => (element.getPropertyNameNode() ?? element.getNameNode()).getText() === SYMBOL,
    );
  return [...propertyAccesses, ...elementAccesses, ...destructurings].map((node) =>
    node.getStartLineNumber(),
  );
}

type Finding = { readonly file: string; readonly line: number };

function scan(files: readonly SourceFile[], roots = resolveRepoRoots()): Finding[] {
  const findings: Finding[] = [];
  for (const sf of files) {
    const file = relFromRepoRoot(sf.getFilePath(), roots);
    if (ALLOWED_PATH.test(file)) continue;
    for (const line of unsafeAppendEventLines(sf)) findings.push({ file, line });
  }
  return findings;
}

function countsPerFile(findings: readonly Finding[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of findings.filter(isLocalFinding)) counts[f.file] = (counts[f.file] ?? 0) + 1;
  return counts;
}

const GUARD_NAME = "Unsafe-Append-Event Guard";
const DEFAULT_BASELINE_FILE = path.join(process.cwd(), ".kumiko-unsafe-append-event-baseline.json");

const REMEDIATION =
  "unsafeAppendEvent drops payload typing. Use ctx.appendEvent (default) or ctx.tryAppendEvent (conflict as result); the untyped variant belongs in migrations/ and upcasters/.";

const REWRITE_COMMAND = `kumiko-guards guards --write-baseline --guard="${GUARD_NAME}"`;

export function createUnsafeAppendEventGuard(baselineFile: string): AstGuard {
  const baseline = baselineRatchet({
    file: baselineFile,
    formatVersion: 1,
    unit: "unsafeAppendEvent call(s)",
  });
  return {
    name: GUARD_NAME,
    scan: SCAN,
    hint: `${REMEDIATION} After a deliberate change: \`${REWRITE_COMMAND}\`.`,
    run(files, roots = resolveRepoRoots()) {
      const findings = scan(files, roots);
      const violations = baseline.check(countsPerFile(findings), REMEDIATION, {
        formatDriftRemediation: `Run \`${REWRITE_COMMAND}\` once.`,
        resolveLine: (file) => findings.find((f) => f.file === file)?.line ?? 1,
      });
      return { violations };
    },
    writeBaseline: (files, roots) => baseline.write(countsPerFile(scan(files, roots))),
  };
}

export const guard = createUnsafeAppendEventGuard(DEFAULT_BASELINE_FILE);

if (import.meta.main) {
  if (process.argv.slice(2).includes("--write-baseline")) {
    const project = buildSharedProject([guard]);
    guard.writeBaseline?.(filesForGuard(project, guard));
    process.exit(0);
  }
  runStandalone(guard);
}
