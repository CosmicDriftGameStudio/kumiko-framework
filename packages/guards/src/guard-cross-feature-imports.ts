#!/usr/bin/env bun
/**
 * Guard: blocks cross-feature deep imports.
 *
 * R1 from docs/plans/architecture/lint-rules.md.
 *
 * What's enforced:
 *   - A file inside feature A may not import from feature B's internals.
 *   - Allowed cross-feature imports: the barrel (`from "../B"`, or
 *     `"../B/index"` / `"../B/index.ts"`), and two side-effect-free public
 *     surface modules — `"../B/contract"` and `"../B/schema/entity"` (with
 *     or without extension). Anything else — `from "../B/types"`,
 *     `from "../B/handlers/foo"`, `from "../B/feature"` — is rejected.
 *   - Same-feature relative imports (`./x`, `../sibling-in-same-feature`)
 *     stay unrestricted.
 *   - Non-relative imports (`@cosmicdrift/kumiko-framework`, `drizzle-orm`, `zod`)
 *     stay unrestricted.
 *
 * Why: deep imports couple feature B's file layout to feature A's call
 * sites. A rename inside B silently breaks A. The barrel is B's public
 * contract — A only sees what B chose to export.
 *
 * Feature-boundary inference:
 *   - packages/bundled-features/src/<feature>/...
 *   - samples/<sample>/src/features/<feature>/...
 *
 * Files outside those layouts (e.g. samples/<sample>/src/feature.ts for
 * single-feature samples, framework internals) have no feature boundary
 * and are skipped.
 *
 * Escape hatch: `// kumiko-lint-ignore cross-feature-import [reason]`
 * on the same line as the import, or on the line directly above.
 *
 * Usage:
 *   bun guards/guard-cross-feature-imports.ts
 *
 * Exit 1 on violations, 0 when clean.
 */

import * as path from "node:path";
import type { SourceFile } from "ts-morph";
import { type AstGuard, runStandalone, type ScanSpec } from "./_lib/guard-kit";

const ROOT = process.cwd();

const SCAN: ScanSpec = {
  scope: "source",
  extensions: ["ts"],
  frameworkWithin: ["packages/*/src/**", "samples/recipes/*/src/**", "samples/apps/*/src/**"],
};

const EXCLUDE = /(__tests__|\.test\.ts$|\.integration\.ts$|\.d\.ts$|\.g\.ts$)/;

// Files with an explicit, documented exception. Each entry must come with a
// TODO naming the planned refactor — the allowlist exists to turn the guard
// on without blocking the merge, not as a permanent home.
const ALLOWLIST: ReadonlyArray<{ pattern: RegExp; reason: string }> = [];

const IGNORE_TAG = "kumiko-lint-ignore cross-feature-import";

interface Violation {
  file: string;
  line: number;
  importPath: string;
  importedFeature: string;
  fileFeature: string;
}

type FeatureLocation = {
  // Repo-relative path of the feature's root directory. Two files resolve
  // to the same boundary iff they live under the same root.
  readonly root: string;
  readonly name: string;
};

// Identifies the feature a file belongs to. Returns null for files that
// live outside any feature boundary (single-feature sample roots,
// framework-internal helpers reached via the same scan).
function locateFeature(absPath: string): FeatureLocation | null {
  const rel = path.relative(ROOT, absPath);

  const coreMatch = rel.match(/^(packages\/bundled-features\/src\/([^/]+))\//);
  if (coreMatch?.[1] && coreMatch[2]) {
    return { root: coreMatch[1], name: coreMatch[2] };
  }

  // Other packages/<pkg>/src layouts (framework internals, enterprise
  // packages): the package itself is the feature boundary — enterprise
  // ships one feature per package (packages/ai-conversation/src/
  // feature.ts), framework packages outside bundled-features have no
  // sub-feature concept. Safe superset: never flags same-package imports,
  // only catches genuine cross-package deep-relative imports — which
  // shouldn't exist anyway since packages are consumed as separate npm
  // packages via bare specifiers, not relative paths.
  const pkgMatch = rel.match(/^(packages\/([^/]+)\/src)\//);
  if (pkgMatch?.[1] && pkgMatch[2]) {
    return { root: pkgMatch[1], name: pkgMatch[2] };
  }

  const sampleMatch = rel.match(/^(samples\/[^/]+\/src\/features\/([^/]+))(\/|$)/);
  if (sampleMatch?.[1] && sampleMatch[2]) {
    return { root: sampleMatch[1], name: sampleMatch[2] };
  }

  // Flat-layout app repos (studio, publicstatus, show-pony, money-horse,
  // phronexsis, offlot-app, solon): src/features/<feature>/...
  const appMatch = rel.match(/^(src\/features\/([^/]+))(\/|$)/);
  if (appMatch?.[1] && appMatch[2]) {
    return { root: appMatch[1], name: appMatch[2] };
  }

  return null;
}

function isAllowlisted(filePath: string): { allowed: true; reason: string } | { allowed: false } {
  const rel = path.relative(ROOT, filePath);
  for (const entry of ALLOWLIST) {
    if (entry.pattern.test(rel)) return { allowed: true, reason: entry.reason };
  }
  return { allowed: false };
}

// Kumiko's feature barrel (feature.ts) doubles as the registration module
// (mounts handlers/entities) — importing it pulls in the whole server
// graph and creates require cycles. These two are side-effect-free
// declaration modules (contract types, entity definition) that exist
// precisely to be read by other features, so they're allowed alongside the
// barrel. Closed set, not "everything but the barrel": `feature`/
// `feature.ts` must stay blocked, that's the registration module the guard
// exists to protect.
const PUBLIC_SURFACE_MODULES = new Set([
  "contract",
  "contract.ts",
  "contract.tsx",
  "schema/entity",
  "schema/entity.ts",
  "schema/entity.tsx",
]);

// True when the resolved import path points inside `featureRoot` AND
// addresses something deeper than the barrel index. The barrel itself
// (a) bare `featureRoot` directory or (b) `featureRoot/index` is the
// public contract — anything else is an internal.
function isDeepImport(resolvedAbs: string, featureRoot: string): boolean {
  const featureRootAbs = path.join(ROOT, featureRoot);
  const rel = path.relative(featureRootAbs, resolvedAbs);
  if (
    rel === "" ||
    rel === "index" ||
    rel === "index.ts" ||
    rel === "index.tsx" ||
    PUBLIC_SURFACE_MODULES.has(rel)
  ) {
    return false;
  }
  // Same-folder index without extension lookup ends up as "index" — keep
  // that allowed; everything else (`types`, `handlers/foo`, etc.) is deep.
  return true;
}

// Resolve a relative import to its absolute on-disk path. ts-morph's
// SourceFile.getModuleSpecifierSourceFile() walks the same resolution the
// compiler uses; we use it so the guard agrees with TS exactly.
function resolveImport(sf: SourceFile, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const importDecl = sf
    .getImportDeclarations()
    .find((d) => d.getModuleSpecifierValue() === specifier);
  if (!importDecl) return null;
  const target = importDecl.getModuleSpecifierSourceFile();
  if (target) return target.getFilePath();
  // The import may resolve to a barrel directory whose index.ts ts-morph
  // didn't add to the project. Fall back to a manual join + .ts probe.
  return path.resolve(path.dirname(sf.getFilePath()), specifier);
}

function isIgnored(sf: SourceFile, importLine: number): boolean {
  const text = sf.getFullText();
  const lines = text.split("\n");
  const onLine = lines[importLine - 1] ?? "";
  if (onLine.includes(IGNORE_TAG)) return true;
  const above = lines[importLine - 2] ?? "";
  return above.trim().startsWith("//") && above.includes(IGNORE_TAG);
}

function findCrossFeatureViolations(sf: SourceFile): Omit<Violation, "file">[] {
  const fileFeature = locateFeature(sf.getFilePath());
  if (!fileFeature) return [];

  const violations: Omit<Violation, "file">[] = [];

  for (const importDecl of sf.getImportDeclarations()) {
    const specifier = importDecl.getModuleSpecifierValue();
    if (!specifier.startsWith(".")) continue;

    const resolved = resolveImport(sf, specifier);
    if (!resolved) continue;

    const importedFeature = locateFeature(resolved);
    if (!importedFeature) continue;
    if (importedFeature.root === fileFeature.root) continue;

    if (!isDeepImport(resolved, importedFeature.root)) continue;

    const line = importDecl.getStartLineNumber();
    if (isIgnored(sf, line)) continue;

    violations.push({
      line,
      importPath: specifier,
      importedFeature: importedFeature.name,
      fileFeature: fileFeature.name,
    });
  }

  return violations;
}

export const guard: AstGuard = {
  name: "Cross-Feature-Import Guard",
  scan: SCAN,
  hint: `Import from the feature's barrel ("../<feature>") instead of its internals. Escape hatch: "// ${IGNORE_TAG} [reason]" on the import line.`,
  run(files) {
    const violations: Array<{ file: string; line: number; message: string }> = [];

    for (const sf of files) {
      const file = sf.getFilePath();
      if (EXCLUDE.test(file)) continue;
      if (isAllowlisted(file).allowed) continue;

      for (const v of findCrossFeatureViolations(sf)) {
        violations.push({
          file: path.relative(ROOT, file),
          line: v.line,
          message: `feature "${v.fileFeature}" → "${v.importedFeature}" (${v.importPath})`,
        });
      }
    }

    return { violations };
  },
};

if (import.meta.main) runStandalone(guard);
