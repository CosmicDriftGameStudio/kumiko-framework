/**
 * Guard: blocks cross-feature deep imports.
 *
 * R1 from docs/plans/architecture/lint-rules.md.
 *
 * What's enforced:
 *   - A file inside feature A may not import from feature B's internals.
 *   - The only allowed cross-feature import is the barrel: `from "../B"`
 *     (or `"../B/index"` / `"../B/index.ts"`). Anything deeper —
 *     `from "../B/types"`, `from "../B/handlers/foo"`, etc. — is rejected.
 *   - Same-feature relative imports (`./x`, `../sibling-in-same-feature`)
 *     stay unrestricted.
 *   - Non-relative imports (`@kumiko/framework`, `drizzle-orm`, `zod`)
 *     stay unrestricted.
 *
 * Why: deep imports couple feature B's file-layout to feature A's call
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
 *   yarn tsx scripts/guard-cross-feature-imports.ts
 *
 * Exit 1 on violations, 0 when clean.
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Project, type SourceFile } from "ts-morph";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const SCAN_GLOBS = [
  "packages/bundled-features/src/**/*.ts",
  "samples/recipes/*/src/**/*.ts",
  "samples/apps/*/src/**/*.ts",
  "samples/showcases/*/src/**/*.ts",
];

const EXCLUDE = /(__tests__|\.test\.ts$|\.integration\.ts$|\.d\.ts$|\.g\.ts$)/;

// Files explicitly granted a documented exception. Each entry must come
// with a TODO that names the planned refactor — the allowlist exists to
// turn the guard on without blocking the merge, not as a permanent home.
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
  // Repository-relative path of the feature's root directory. Two files
  // resolve to the same boundary iff they live under the same root.
  readonly root: string;
  readonly name: string;
};

// Identify the feature a file belongs to. Returns null for files that
// live outside any feature boundary (single-feature sample roots,
// framework-internal helpers reached via the same scan).
function locateFeature(absPath: string): FeatureLocation | null {
  const rel = path.relative(ROOT, absPath);

  const coreMatch = rel.match(/^(packages\/bundled-features\/src\/([^/]+))\//);
  if (coreMatch?.[1] && coreMatch[2]) {
    return { root: coreMatch[1], name: coreMatch[2] };
  }

  const sampleMatch = rel.match(/^(samples\/[^/]+\/src\/features\/([^/]+))(\/|$)/);
  if (sampleMatch?.[1] && sampleMatch[2]) {
    return { root: sampleMatch[1], name: sampleMatch[2] };
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

// True when the resolved import path points inside `featureRoot` AND
// addresses something deeper than the barrel index. The barrel itself
// (a) bare `featureRoot` directory or (b) `featureRoot/index` is the
// public contract — anything else is an internal.
function isDeepImport(resolvedAbs: string, featureRoot: string): boolean {
  const featureRootAbs = path.join(ROOT, featureRoot);
  const rel = path.relative(featureRootAbs, resolvedAbs);
  if (rel === "" || rel === "index" || rel === "index.ts" || rel === "index.tsx") {
    return false;
  }
  // Same-folder index without extension lookup ends up as "index" — keep
  // that allowed; everything else (`types`, `handlers/foo`, etc.) is deep.
  return true;
}

// Resolve a relative import to its absolute on-disk path. ts-morph's
// SourceFile.getModuleSpecifierSourceFile() walks the same resolution
// the compiler uses; we use it so the guard agrees with TS exactly.
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

async function main(): Promise<void> {
  const project = new Project({
    tsConfigFilePath: path.join(ROOT, "packages/framework/tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });

  for (const glob of SCAN_GLOBS) {
    project.addSourceFilesAtPaths(path.join(ROOT, glob));
  }

  const violations: Violation[] = [];
  let scannedFiles = 0;
  let allowlistedFiles = 0;

  for (const sf of project.getSourceFiles()) {
    const file = sf.getFilePath();
    if (EXCLUDE.test(file)) continue;
    const allowed = isAllowlisted(file);
    if (allowed.allowed) {
      allowlistedFiles++;
      continue;
    }
    scannedFiles++;

    for (const v of findCrossFeatureViolations(sf)) {
      violations.push({ file: path.relative(ROOT, file), ...v });
    }
  }

  console.log(
    `Cross-Feature-Import Guard: ${scannedFiles} files scanned (${allowlistedFiles} allowlisted), ${violations.length} violations.`,
  );

  if (violations.length === 0) {
    console.log("  No cross-feature deep imports in feature code.");
    return;
  }

  console.error(
    `\n  BLOCKED: ${violations.length} cross-feature deep imports. Import from the feature's barrel ` +
      `("../<feature>") instead of reaching into its internals. Add to the feature's index.ts what ` +
      `should be public.\n  Escape hatch: "// ${IGNORE_TAG} [reason]" on the import line.\n`,
  );
  for (const v of violations) {
    console.error(
      `    ${v.file}:${v.line}  feature "${v.fileFeature}" → "${v.importedFeature}"  (${v.importPath})`,
    );
  }
  console.error("");
  process.exit(1);
}

main();
