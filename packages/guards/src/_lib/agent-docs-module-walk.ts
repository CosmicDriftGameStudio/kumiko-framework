import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  ExportDeclaration,
  FunctionDeclaration,
  ImportDeclaration,
  Project,
  SourceFile,
  VariableDeclaration,
} from "ts-morph";

// Syntactic module walk over relative specifiers. Asking ts-morph to resolve a
// specifier rebuilds the program after every added file, which made one
// generator run take seconds per package; package specifiers stay unresolved.
export function relativeModuleFile(
  project: Project,
  declaration: ImportDeclaration | ExportDeclaration,
): SourceFile | undefined {
  const specifier = declaration.getModuleSpecifierValue();
  if (specifier === undefined || !specifier.startsWith(".")) return undefined;
  const base = join(dirname(declaration.getSourceFile().getFilePath()), specifier);
  const withoutJs = base.replace(/\.js$/, "");
  const candidates = [base, `${withoutJs}.ts`, `${withoutJs}.tsx`, join(base, "index.ts")];
  const path = candidates.find((candidate) => /\.tsx?$/.test(candidate) && existsSync(candidate));
  if (path === undefined) return undefined;
  return project.getSourceFile(path) ?? project.addSourceFileAtPath(path);
}

function reExportTargets(
  project: Project,
  file: SourceFile,
  name: string,
): { target: SourceFile; name: string }[] {
  const targets: { target: SourceFile; name: string }[] = [];
  for (const declaration of file.getExportDeclarations()) {
    const target = relativeModuleFile(project, declaration);
    if (declaration.isTypeOnly() || target === undefined) continue;
    const named = declaration.getNamedExports();
    if (named.length === 0) targets.push({ target, name });
    for (const spec of named) {
      const exported = (spec.getAliasNode() ?? spec.getNameNode()).getText();
      if (exported === name) targets.push({ target, name: spec.getName() });
    }
  }
  return targets;
}

export function exportedVariable(
  project: Project,
  file: SourceFile,
  name: string,
  seen = new Set<SourceFile>(),
): VariableDeclaration | undefined {
  seen.add(file);
  const local = file.getVariableDeclaration(name);
  if (local !== undefined) return local;
  for (const hop of reExportTargets(project, file, name)) {
    if (seen.has(hop.target)) continue;
    const found = exportedVariable(project, hop.target, hop.name, seen);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function importedVariable(
  project: Project,
  file: SourceFile,
  name: string,
): VariableDeclaration | undefined {
  const declaration = file
    .getImportDeclarations()
    .find((candidate) => candidate.getNamedImports().some((spec) => spec.getName() === name));
  const spec = declaration?.getNamedImports().find((candidate) => candidate.getName() === name);
  const target = declaration === undefined ? undefined : relativeModuleFile(project, declaration);
  if (spec === undefined || target === undefined) return undefined;
  const original = spec.getNameNode().getText();
  return exportedVariable(project, target, original);
}

export function exportedFunctions(
  project: Project,
  file: SourceFile,
  seen = new Set<SourceFile>(),
): Map<string, FunctionDeclaration> {
  seen.add(file);
  const found = new Map<string, FunctionDeclaration>();
  for (const fn of file.getFunctions()) {
    const name = fn.getName();
    if (fn.isExported() && name !== undefined) found.set(name, fn);
  }
  for (const declaration of file.getExportDeclarations()) {
    const target = relativeModuleFile(project, declaration);
    if (declaration.isTypeOnly() || target === undefined || seen.has(target)) continue;
    const targetFunctions = exportedFunctions(project, target, seen);
    const named = declaration.getNamedExports();
    if (named.length === 0) for (const [name, fn] of targetFunctions) found.set(name, fn);
    for (const spec of named) {
      const fn = targetFunctions.get(spec.getName());
      if (fn !== undefined) found.set((spec.getAliasNode() ?? spec.getNameNode()).getText(), fn);
    }
  }
  return found;
}
