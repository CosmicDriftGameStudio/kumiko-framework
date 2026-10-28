import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  type FunctionDeclaration,
  Node,
  type Project,
  type SourceFile,
  SyntaxKind,
} from "ts-morph";
import { exportedFunctions, importedVariable } from "./agent-docs-module-walk";
import { compareCodepoint, isRecord, parseJsonFile } from "./agent-docs-shared";

const PACKAGES_DIR = "packages";
const FEATURE_FACTORY_RE = /^create\w*Feature$/;
const SOURCE_FILE_RE = /\.tsx?$/;
const TEST_PATH_RE = /(__tests__|\.test\.tsx?$|\.d\.ts$)/;

export type FeatureImport =
  | {
      readonly kind: "resolved";
      readonly importPath: string;
      readonly exportNames: readonly string[];
      readonly call?: string;
    }
  | { readonly kind: "unresolved" };

type FeatureDefinitionSite = {
  readonly packageDir: string;
  readonly srcSegment: string;
  readonly factoryName: string | undefined;
};

function sourceFilesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf-8" })
    .filter((rel) => SOURCE_FILE_RE.test(rel) && !TEST_PATH_RE.test(rel))
    .map((rel) => join(dir, rel));
}

function stringValue(project: Project, node: Node | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (Node.isStringLiteral(node)) return node.getLiteralValue();
  if (Node.isAsExpression(node)) return stringValue(project, node.getExpression());
  if (!Node.isIdentifier(node)) return undefined;
  const file = node.getSourceFile();
  const name = node.getText();
  const declaration = file.getVariableDeclaration(name) ?? importedVariable(project, file, name);
  return stringValue(project, declaration?.getInitializer());
}

function isTopLevelVariable(node: Node): boolean {
  return (
    Node.isVariableDeclaration(node) && Node.isSourceFile(node.getVariableStatement()?.getParent())
  );
}

// The factory is the enclosing function, or a module-level constant; a local
// `const feature = defineFeature(…)` inside a factory is not one.
function enclosingFactoryName(node: Node): string | undefined {
  const owner =
    node.getFirstAncestor(Node.isFunctionDeclaration) ?? node.getFirstAncestor(isTopLevelVariable);
  return Node.isFunctionDeclaration(owner) || Node.isVariableDeclaration(owner)
    ? owner.getName()
    : undefined;
}

// Where each feature name is passed to defineFeature in a package source. A
// name defined only outside packages/ (a sample app) has no import path.
function featureDefinitionSites(
  repoRoot: string,
  project: Project,
): ReadonlyMap<string, FeatureDefinitionSite[]> {
  const sites = new Map<string, FeatureDefinitionSite[]>();
  for (const packageName of readdirSync(join(repoRoot, PACKAGES_DIR)).sort(compareCodepoint)) {
    const packageDir = `${PACKAGES_DIR}/${packageName}`;
    const srcDir = join(repoRoot, packageDir, "src");
    for (const path of sourceFilesUnder(srcDir)) {
      if (!readFileSync(path, "utf-8").includes("defineFeature(")) continue;
      const calls = project
        .addSourceFileAtPath(path)
        .getDescendantsOfKind(SyntaxKind.CallExpression)
        .filter((call) => call.getExpression().getText() === "defineFeature");
      for (const call of calls) {
        const name = stringValue(project, call.getArguments()[0]);
        if (name === undefined) continue;
        const srcSegment = relative(srcDir, path).split(sep)[0] ?? "";
        const list = sites.get(name) ?? [];
        list.push({ packageDir, srcSegment, factoryName: enclosingFactoryName(call) });
        sites.set(name, list);
      }
    }
  }
  return sites;
}

type ExportEntry = { readonly importPath: string; readonly file: SourceFile };

function exportEntries(repoRoot: string, project: Project, site: FeatureDefinitionSite) {
  const rel = `${site.packageDir}/package.json`;
  const parsed = parseJsonFile(rel, readFileSync(join(repoRoot, rel), "utf-8"));
  const name = isRecord(parsed) ? parsed["name"] : undefined;
  const exportsField = isRecord(parsed) ? parsed["exports"] : undefined;
  if (typeof name !== "string" || !isRecord(exportsField)) return [];
  const entries: ExportEntry[] = [];
  for (const subpath of [`./${site.srcSegment.replace(SOURCE_FILE_RE, "")}`, "."]) {
    const target = exportsField[subpath];
    const path = isRecord(target) ? target["types"] : target;
    if (typeof path !== "string" || !SOURCE_FILE_RE.test(path)) continue;
    entries.push({
      importPath: subpath === "." ? name : `${name}/${subpath.slice(2)}`,
      file: project.addSourceFileAtPath(join(repoRoot, site.packageDir, path)),
    });
  }
  return entries;
}

// `options.<flag> === true ? <factory>() : …` inside an exported factory means
// that factory with `{ <flag>: true }` builds the feature.
function flagCall(name: string, fn: FunctionDeclaration, factoryName: string): string | undefined {
  const body = (fn.getImplementation() ?? fn).getBody();
  for (const conditional of body?.getDescendantsOfKind(SyntaxKind.ConditionalExpression) ?? []) {
    const whenTrue = conditional.getWhenTrue();
    const condition = conditional.getCondition();
    if (!Node.isCallExpression(whenTrue) || whenTrue.getExpression().getText() !== factoryName) {
      continue;
    }
    if (!Node.isBinaryExpression(condition) || condition.getRight().getText() !== "true") continue;
    const flag = condition.getLeft();
    if (Node.isPropertyAccessExpression(flag)) return `${name}({ ${flag.getName()}: true })`;
  }
  return undefined;
}

function resolveAt(
  project: Project,
  entry: ExportEntry,
  factoryName: string | undefined,
): FeatureImport | undefined {
  const functions = exportedFunctions(project, entry.file);
  const importPath = entry.importPath;
  if (factoryName !== undefined && functions.has(factoryName)) {
    return { kind: "resolved", importPath, exportNames: [factoryName] };
  }
  const factories = [...functions.keys()]
    .filter((name) => FEATURE_FACTORY_RE.test(name))
    .sort(compareCodepoint);
  for (const name of factories) {
    const fn = functions.get(name);
    const call =
      fn === undefined || factoryName === undefined ? undefined : flagCall(name, fn, factoryName);
    if (call !== undefined) return { kind: "resolved", importPath, exportNames: [name], call };
  }
  return factories.length === 0
    ? undefined
    : { kind: "resolved", importPath, exportNames: factories };
}

// undefined: the feature is not defined in a package, so an app cannot import it.
export function createFeatureImportResolver(
  repoRoot: string,
  project: Project,
): (featureName: string) => FeatureImport | undefined {
  const sites = featureDefinitionSites(repoRoot, project);
  return (featureName) => {
    const candidates = sites.get(featureName);
    if (candidates === undefined) return undefined;
    for (const site of candidates) {
      for (const entry of exportEntries(repoRoot, project, site)) {
        const resolved = resolveAt(project, entry, site.factoryName);
        if (resolved !== undefined) return resolved;
      }
    }
    return { kind: "unresolved" };
  };
}
