#!/usr/bin/env bun
/**
 * Guard: every feature in packages/bundled-features/src/<name>/feature.ts
 * must be imported by at least one *.integration.ts. Otherwise it never ran
 * through the full stack — exactly the "feature built, never wired up" case
 * from CLAUDE.md.
 *
 * Coverage rule: a feature counts as covered when an integration test
 * imports anything — relative or via the `@cosmicdrift/kumiko-bundled-features`
 * package — that resolves into its `packages/bundled-features/src/<name>/`
 * directory. That's deliberately broader than "imports feature.ts itself":
 * a test that imports a sibling module of the feature (e.g. its resolver,
 * its defaults helper) still proves the directory ran, and a barrel import
 * of the whole package still proves the feature was composed. Since the
 * `<name>-feature.ts` -> `feature.ts` rename (df3f6b5b) the file basename is
 * identical for all 56 features — the directory name is the only usable
 * identifier.
 *
 * Usage:
 *   bun guards/guard-feature-integration-tests.ts
 */

import * as path from "node:path";
import { Project, SyntaxKind } from "ts-morph";
import {
  type GuardViolation,
  type RepoCheck,
  reportResults,
  runRepoChecks,
} from "./_lib/guard-kit";
import { frameworkPackageTsConfigPath, type RepoRoot } from "./_lib/roots";
import { type ScanSpec, scanFiles } from "./_lib/scan-scope";

const ROOT = process.cwd();

const FEATURES_SCAN: ScanSpec = {
  scope: "source",
  extensions: ["ts"],
  kinds: ["framework"],
  frameworkWithin: ["packages/bundled-features/src/**/feature.ts"],
};
// Both suffixes: `.integration.ts` (legacy) and `.integration.test.ts`
// (canonical after the bun-test cutover). dev-server covers features
// indirectly (walkthrough tests that compose real bundled features) — must
// be scanned too, otherwise those feature references stay invisible.
const INTEGRATION_SCAN: ScanSpec = {
  scope: "source",
  extensions: ["ts"],
  kinds: ["framework"],
  frameworkWithin: [
    "packages/bundled-features/src/**/*.integration.ts",
    "packages/bundled-features/src/**/*.integration.test.ts",
    "packages/framework/src/**/*.integration.ts",
    "packages/framework/src/**/*.integration.test.ts",
    "packages/dev-server/src/**/*.integration.ts",
    "packages/dev-server/src/**/*.integration.test.ts",
  ],
};

const BUNDLED_FEATURES_PACKAGE_SPEC = /^@cosmicdrift\/kumiko-bundled-features\/([^/]+)/;
const BUNDLED_FEATURES_SRC_DIR = /bundled-features\/src\/([^/]+)\//;

/**
 * Resolves an import specifier to the feature ID it reaches, or `null` if
 * the import doesn't land inside a bundled feature's directory. Pure —
 * testable without a Project.
 */
export function extractFeatureId(spec: string, importingFilePath: string): string | null {
  const packageMatch = spec.match(BUNDLED_FEATURES_PACKAGE_SPEC);
  if (packageMatch) return packageMatch[1] ?? null;

  if (!spec.startsWith(".")) return null;
  const resolved = path.resolve(path.dirname(importingFilePath), spec);
  // A relative import that never leaves the __tests__ dir (./helpers,
  // ./fixtures) doesn't prove the feature itself is imported anywhere —
  // only that its test has co-located helpers.
  if (resolved.split(path.sep).includes("__tests__")) return null;
  const dirMatch = `${resolved}/`.match(BUNDLED_FEATURES_SRC_DIR);
  return dirMatch?.[1] ?? null;
}

function collectFeatures(project: Project, paths: readonly string[]): Map<string, string> {
  const features = new Map<string, string>();
  for (const p of paths) {
    const sf = project.getSourceFile(p) ?? project.addSourceFileAtPath(p);
    const filePath = sf.getFilePath();
    if (path.basename(filePath) !== "feature.ts") continue;
    // Same derivation as extractFeatureId (producer/consumer must agree, or
    // a nested feature dir orphans permanently — no import could ever
    // satisfy a mismatched ID). Also filters out non-feature `feature.ts`
    // fixtures (e.g. under __tests__) that don't sit in a bundled-features
    // src dir.
    const dirMatch = `${filePath}`.match(BUNDLED_FEATURES_SRC_DIR);
    const featureId = dirMatch?.[1];
    if (!featureId) continue;
    features.set(featureId, path.relative(ROOT, filePath));
  }
  return features;
}

function collectImportedFeatureIds(project: Project, roots: readonly RepoRoot[]): Set<string> {
  for (const p of scanFiles(INTEGRATION_SCAN, roots)) {
    if (!project.getSourceFile(p)) project.addSourceFileAtPath(p);
  }
  const imported = new Set<string>();
  for (const sf of project.getSourceFiles()) {
    if (!/\.integration(\.test)?\.ts$/.test(sf.getFilePath())) continue;
    for (const imp of sf.getDescendantsOfKind(SyntaxKind.ImportDeclaration)) {
      const featureId = extractFeatureId(imp.getModuleSpecifierValue(), sf.getFilePath());
      if (featureId) imported.add(featureId);
    }
  }
  return imported;
}

/**
 * Baseline from the infra#436 measurement: features with no integration
 * test reaching their directory at all — only covered (if at all) by unit
 * tests (`feature.test.ts`). Pre-existing at the first sharp run, not
 * introduced by this change. Backfilling is its own scope per feature, not
 * a sweep.
 */
const ALLOWLIST: ReadonlySet<string> = new Set(["step-dispatcher"]);

export function computeOrphans(
  features: ReadonlyMap<string, string>,
  imported: ReadonlySet<string>,
  allowlist: ReadonlySet<string> = ALLOWLIST,
): Array<{ name: string; file: string }> {
  const orphans: Array<{ name: string; file: string }> = [];
  for (const [id, file] of features) {
    if (!imported.has(id) && !allowlist.has(id)) orphans.push({ name: id, file });
  }
  return orphans;
}

export const check: RepoCheck = {
  name: "Feature-Integration-Test Guard",
  hint:
    "Every feature needs a *.integration.ts that uses it in " +
    "setupTestStack({ features: [...] }).",
  run(roots) {
    if (!roots.some((r) => r.kind === "framework")) {
      return { violations: [], matchedFiles: 0, notApplicable: true };
    }

    const project = new Project({
      tsConfigFilePath: frameworkPackageTsConfigPath("bundled-features"),
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
    });

    const featurePaths = scanFiles(FEATURES_SCAN, roots);
    const features = collectFeatures(project, featurePaths);
    const imported = collectImportedFeatureIds(project, roots);

    const violations: GuardViolation[] = [];

    const stale = [...ALLOWLIST].filter((id) => imported.has(id));
    for (const id of stale) {
      violations.push({
        file: features.get(id) ?? id,
        line: 1,
        message: `Allowlist entry "${id}" is now covered by an integration test — remove it from ALLOWLIST.`,
      });
    }

    for (const orphan of computeOrphans(features, imported)) {
      violations.push({
        file: orphan.file,
        line: 1,
        message:
          "Feature without an integration test — needs a *.integration.ts that uses it in setupTestStack({ features: [...] }).",
      });
    }

    return { violations, matchedFiles: featurePaths.length, notApplicable: false };
  },
};

if (import.meta.main) {
  const failed = reportResults(await runRepoChecks([check]));
  process.exit(failed > 0 ? 1 : 0);
}
