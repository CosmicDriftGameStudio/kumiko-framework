import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Project, SourceFile } from "ts-morph";
import { compareCodepoint, isRecord, parseJsonFile } from "./agent-docs-shared";

const BUNDLED_FEATURES_DIR = "packages/bundled-features";
const FEATURE_FACTORY_RE = /^create\w*Feature$/;

export type FeatureImport = {
  readonly importPath: string;
  readonly exportNames: readonly string[];
};

type PackageInfo = { readonly name: string; readonly exports: Record<string, unknown> };

function readPackage(repoRoot: string, packageDir: string): PackageInfo {
  const rel = `${packageDir}/package.json`;
  const parsed = parseJsonFile(rel, readFileSync(join(repoRoot, rel), "utf-8"));
  const name = isRecord(parsed) ? parsed["name"] : undefined;
  const exportsField = isRecord(parsed) ? parsed["exports"] : undefined;
  if (typeof name !== "string" || !isRecord(exportsField)) {
    throw new Error(`${rel}: needs a name and an exports map`);
  }
  return { name, exports: exportsField };
}

function exportSourcePath(info: PackageInfo, subpath: string): string | undefined {
  const target = info.exports[subpath];
  const path = isRecord(target) ? target["types"] : target;
  return typeof path === "string" && /\.tsx?$/.test(path) ? path : undefined;
}

// Syntactic walk over value exports: the checker-based export table costs
// seconds per package and only names are needed here.
function featureFactoryExports(file: SourceFile, seen: Set<SourceFile>): string[] {
  seen.add(file);
  const names = file
    .getFunctions()
    .filter((fn) => fn.isExported())
    .map((fn) => fn.getName() ?? "");
  for (const statement of file.getVariableStatements()) {
    if (statement.isExported()) names.push(...statement.getDeclarations().map((d) => d.getName()));
  }
  for (const declaration of file.getExportDeclarations()) {
    if (declaration.isTypeOnly()) continue;
    const named = declaration.getNamedExports();
    names.push(...named.map((spec) => (spec.getAliasNode() ?? spec.getNameNode()).getText()));
    const target = named.length === 0 ? declaration.getModuleSpecifierSourceFile() : undefined;
    if (target !== undefined && !seen.has(target))
      names.push(...featureFactoryExports(target, seen));
  }
  return names.filter((name) => FEATURE_FACTORY_RE.test(name));
}

function pascalCase(featureName: string): string {
  return featureName
    .split("-")
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join("");
}

type ImportCandidate = { readonly importPath: string; readonly sourcePath: string };

function importCandidates(repoRoot: string, featureName: string): ImportCandidate[] {
  const candidates: ImportCandidate[] = [];
  const bundled = readPackage(repoRoot, BUNDLED_FEATURES_DIR);
  const bundledPath = exportSourcePath(bundled, `./${featureName}`);
  if (bundledPath !== undefined) {
    candidates.push({
      importPath: `${bundled.name}/${featureName}`,
      sourcePath: join(repoRoot, BUNDLED_FEATURES_DIR, bundledPath),
    });
  }
  const ownDir = `packages/${featureName}`;
  if (existsSync(join(repoRoot, ownDir, "package.json"))) {
    const own = readPackage(repoRoot, ownDir);
    const ownPath = exportSourcePath(own, ".");
    if (ownPath !== undefined) {
      candidates.push({ importPath: own.name, sourcePath: join(repoRoot, ownDir, ownPath) });
    }
  }
  return candidates;
}

// A feature lives in the bundled-features subpath or the package of the same
// name. The factory named after the feature wins; otherwise every factory the
// entry exports is listed, since the manifest does not record which one it is.
export function featureImport(
  repoRoot: string,
  project: Project,
  featureName: string,
): FeatureImport | undefined {
  const expected = `create${pascalCase(featureName)}Feature`;
  const found = importCandidates(repoRoot, featureName).map((candidate) => ({
    importPath: candidate.importPath,
    exportNames: [
      ...new Set(
        featureFactoryExports(project.addSourceFileAtPath(candidate.sourcePath), new Set()),
      ),
    ].sort(compareCodepoint),
  }));
  const exact = found.find((entry) => entry.exportNames.includes(expected));
  if (exact !== undefined) return { importPath: exact.importPath, exportNames: [expected] };
  return found.find((entry) => entry.exportNames.length > 0);
}
