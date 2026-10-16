#!/usr/bin/env bun
/**
 * Guard: the generated agent docs under `packages/framework/agents/` must
 * match what `bun run gen:agent-docs` renders from the current sources
 * (feature manifest, renderer-web exports, sample recipes), and every
 * `agents/<file>.md` path the hand-written `packages/framework/AGENTS.md`
 * points at must exist in that generated set.
 *
 * Only the framework repo itself has these files; consumer repos are
 * `notApplicable`.
 *
 * Usage:
 *   bun guard-agent-docs-drift.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_DOCS_DIR, readAgentDocsOnDisk, renderAgentDocs } from "./_lib/agent-docs";
import {
  type GuardViolation,
  type RepoCheck,
  type RepoCheckOutcome,
  reportResults,
  runRepoChecks,
} from "./_lib/guard-kit";
import type { RepoRoot } from "./_lib/roots";

const FRAMEWORK_PACKAGE_JSON_REL = "packages/framework/package.json";
const FRAMEWORK_PACKAGE_NAME = "@cosmicdrift/kumiko-framework";
const AGENTS_MD_REL = "packages/framework/AGENTS.md";
const AGENTS_REF_RE = /`agents\/([A-Za-z0-9._/-]+\.md)`/g;
const REGENERATE_HINT = "run `bun run gen:agent-docs` and commit the result";

function isFrameworkRepo(root: RepoRoot): boolean {
  const packageJsonPath = join(root.absPath, FRAMEWORK_PACKAGE_JSON_REL);
  if (!existsSync(packageJsonPath)) return false;
  try {
    const parsed: unknown = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      "name" in parsed &&
      parsed.name === FRAMEWORK_PACKAGE_NAME
    );
  } catch {
    return false;
  }
}

function firstDifferingLine(expected: string, actual: string): number {
  const expectedLines = expected.split("\n");
  const actualLines = actual.split("\n");
  const length = Math.max(expectedLines.length, actualLines.length);
  for (let index = 0; index < length; index++) {
    if (expectedLines[index] !== actualLines[index]) return index + 1;
  }
  return 1;
}

function agentsMdReferenceViolations(
  absPath: string,
  generated: ReadonlyMap<string, string>,
): GuardViolation[] {
  const agentsMdPath = join(absPath, AGENTS_MD_REL);
  if (!existsSync(agentsMdPath)) return [];
  const violations: GuardViolation[] = [];
  const lines = readFileSync(agentsMdPath, "utf-8").split("\n");
  lines.forEach((text, index) => {
    for (const match of text.matchAll(AGENTS_REF_RE)) {
      const key = match[1];
      if (key === undefined || generated.has(key)) continue;
      violations.push({
        file: AGENTS_MD_REL,
        line: index + 1,
        message: `references agents/${key}, which is not generated. Fix the reference or add the source (an example needs samples/recipes/<slug>/package.json).`,
      });
    }
  });
  return violations;
}

function rootViolations(absPath: string): { violations: GuardViolation[]; fileCount: number } {
  const generated = renderAgentDocs(absPath);
  const onDisk = readAgentDocsOnDisk(absPath);
  const violations: GuardViolation[] = [];
  for (const [rel, expected] of generated) {
    const file = `${AGENT_DOCS_DIR}/${rel}`;
    const actual = onDisk.get(rel);
    if (actual === undefined) {
      violations.push({
        file,
        line: 1,
        message: `generated file is missing; ${REGENERATE_HINT}`,
      });
    } else if (actual !== expected) {
      violations.push({
        file,
        line: firstDifferingLine(expected, actual),
        message: `content differs from the generated output; ${REGENERATE_HINT}`,
      });
    }
  }
  for (const rel of onDisk.keys()) {
    if (generated.has(rel)) continue;
    violations.push({
      file: `${AGENT_DOCS_DIR}/${rel}`,
      line: 1,
      message: `stale file no longer produced by the generator; ${REGENERATE_HINT}`,
    });
  }
  violations.push(...agentsMdReferenceViolations(absPath, generated));
  return { violations, fileCount: generated.size };
}

export const check: RepoCheck = {
  name: "agent-docs-drift",
  hint: "Run `bun run gen:agent-docs` and commit packages/framework/agents/.",
  run(roots): RepoCheckOutcome {
    const frameworkRoots = roots.filter(isFrameworkRepo);
    if (frameworkRoots.length === 0) {
      return { violations: [], matchedFiles: 0, notApplicable: true };
    }
    const violations: GuardViolation[] = [];
    let matchedFiles = 0;
    for (const root of frameworkRoots) {
      const result = rootViolations(root.absPath);
      violations.push(...result.violations);
      matchedFiles += result.fileCount;
    }
    return { violations, matchedFiles, notApplicable: false };
  },
};

if (import.meta.main) {
  const failed = reportResults(await runRepoChecks([check]));
  process.exit(failed > 0 ? 1 : 0);
}
