#!/usr/bin/env bun
// s3-imports — the S3 file providers merged into one `file-provider-s3` subpath:
//   .../files-provider-s3                                -> .../file-provider-s3/lib
//   fileProviderS3EnvFeature (.../file-provider-s3-env)  -> createFileProviderS3Feature({ fromEnv: true })
// `fileProviderS3Feature` -> `createFileProviderS3Feature()` is feature-factory.ts's job; the two
// codemods leave the same result in either order.
//
// Usage:
//   bun scripts/codemod/s3-imports.ts <targetDir...> [--check | --dry-run | --write] [--no-format]
// Without a mode flag it writes (kumiko-upgrade --apply calls it that way). --check exits 1
// while any rewritable or manual site is left; --dry-run only reports.

import { type ImportDeclaration, Node, Project, type SourceFile, SyntaxKind } from "ts-morph";
import {
  type CodemodResult,
  type CodemodSite,
  ensureNamedImport,
  hasImportBinding,
  relativeSpecifier,
  removeNamedImport,
  runCodemodCli,
  type SiteLists,
  sourceRelativeModule,
} from "./codemod-support.js";

const BUNDLED_PACKAGE = "@cosmicdrift/kumiko-bundled-features";
const BUNDLED_SRC_MARKER = "/packages/bundled-features/src/";
const OLD_LIB_FOLDER = "files-provider-s3";
const NEW_LIB_MODULE = "file-provider-s3/lib";
const ENV_FOLDER = "file-provider-s3-env";
const MERGED_FOLDER = "file-provider-s3";
const ENV_CONSTANT = "fileProviderS3EnvFeature";
const MERGED_FACTORY = "createFileProviderS3Feature";
const ENV_CALL = `${MERGED_FACTORY}({ fromEnv: true })`;

const CHEAP_PREFILTER = /files-provider-s3|fileProviderS3EnvFeature/;
const SKIPPED_PATH_SUFFIXES: readonly string[] = [
  "packages/bundled-features/src/files-provider-s3/index.ts",
  "packages/bundled-features/src/file-provider-s3-env/index.ts",
  "packages/framework/src/scripts/codemod/s3-imports.ts",
  "packages/framework/src/__tests__/s3-imports-codemod.test.ts",
];

function newLibSpecifier(specifier: string, filePath: string): string | undefined {
  if (specifier === `${BUNDLED_PACKAGE}/${OLD_LIB_FOLDER}`) {
    return `${BUNDLED_PACKAGE}/${NEW_LIB_MODULE}`;
  }
  const relativeModule = sourceRelativeModule(specifier, filePath, BUNDLED_SRC_MARKER);
  if (relativeModule === undefined) return undefined;
  const { root, module, extension } = relativeModule;
  if (module !== OLD_LIB_FOLDER && !module.startsWith(`${OLD_LIB_FOLDER}/`)) return undefined;
  return relativeSpecifier(
    filePath,
    root,
    `${NEW_LIB_MODULE}${module.slice(OLD_LIB_FOLDER.length)}`,
    extension,
  );
}

function envModuleReplacement(specifier: string, filePath: string): string | undefined {
  if (specifier === `${BUNDLED_PACKAGE}/${ENV_FOLDER}`) {
    return `${BUNDLED_PACKAGE}/${MERGED_FOLDER}`;
  }
  const relativeModule = sourceRelativeModule(specifier, filePath, BUNDLED_SRC_MARKER);
  if (relativeModule === undefined) return undefined;
  const { root, module, extension } = relativeModule;
  if (module !== ENV_FOLDER && !/^file-provider-s3-env\/(index|feature)$/.test(module)) {
    return undefined;
  }
  return relativeSpecifier(
    filePath,
    root,
    `${MERGED_FOLDER}${module.slice(ENV_FOLDER.length)}`,
    extension,
  );
}

function site(file: string, node: Node, description: string): CodemodSite {
  return { file, line: node.getStartLineNumber(), description };
}

function stringLiteralOf(node: Node | undefined): Node | undefined {
  return node !== undefined && Node.isStringLiteral(node) ? node : undefined;
}

interface TextEdit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

function applyEdits(source: string, edits: readonly TextEdit[]): string {
  let output = source;
  for (const edit of [...edits].sort((x, y) => y.start - x.start)) {
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  }
  return output;
}

function moduleSpecifierLiterals(sourceFile: SourceFile): Node[] {
  const literals: Node[] = [];
  for (const declaration of [
    ...sourceFile.getImportDeclarations(),
    ...sourceFile.getExportDeclarations(),
  ]) {
    const literal = declaration.getModuleSpecifier();
    if (literal !== undefined) literals.push(literal);
  }
  for (const importType of sourceFile.getDescendantsOfKind(SyntaxKind.ImportType)) {
    const argument = importType.getArgument();
    if (Node.isLiteralTypeNode(argument)) literals.push(argument.getLiteral());
  }
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    const isModuleLoad =
      callee.getKind() === SyntaxKind.ImportKeyword || callee.getText() === "mock.module";
    const literal = stringLiteralOf(call.getArguments()[0]);
    if (isModuleLoad && literal !== undefined) literals.push(literal);
  }
  return literals;
}

function rewriteLibSpecifiers(
  sourceFile: SourceFile,
  source: string,
  filePath: string,
  result: SiteLists,
): string {
  const edits: TextEdit[] = [];
  for (const literal of moduleSpecifierLiterals(sourceFile)) {
    if (!Node.isStringLiteral(literal)) continue;
    const current = literal.getLiteralValue();
    const next = newLibSpecifier(current, filePath);
    if (next === undefined) continue;
    result.rewrites.push(site(filePath, literal, `${current} -> ${next}`));
    edits.push({ start: literal.getStart(), end: literal.getEnd(), text: JSON.stringify(next) });
  }
  return applyEdits(source, edits);
}

function envFactoryEdit(reference: Node): TextEdit | "manual-type" | "manual-export" {
  const parent = reference.getParent();
  if (Node.isTypeQuery(parent)) return "manual-type";
  if (Node.isExportSpecifier(parent)) return "manual-export";
  const text = Node.isShorthandPropertyAssignment(parent)
    ? `${ENV_CONSTANT}: ${ENV_CALL}`
    : ENV_CALL;
  return { start: reference.getStart(), end: reference.getEnd(), text };
}

interface EnvImportTarget {
  readonly specifier: string;
  readonly isTypeOnly: boolean;
}

// Collects the call-site edits of one import declaration. Returns false when a site can only be
// fixed by hand, so the import is left untouched too.
function planEnvDeclaration(
  declaration: ImportDeclaration,
  filePath: string,
  edits: TextEdit[],
  result: SiteLists,
): boolean {
  const named = declaration.getNamedImports().find((n) => n.getName() === ENV_CONSTANT);
  if (named === undefined) return false;
  const nameNode = named.getNameNode();
  if (named.getAliasNode() !== undefined || !Node.isIdentifier(nameNode)) {
    result.manual.push(
      site(filePath, named, `${ENV_CONSTANT} imported under an alias: call ${ENV_CALL} by hand`),
    );
    return false;
  }
  const references = nameNode
    .findReferencesAsNodes()
    .filter((reference) => reference.getFirstAncestor((a) => a === declaration) === undefined);
  const planned = references.map((reference) => ({ reference, edit: envFactoryEdit(reference) }));
  const blocked = planned.filter(({ edit }) => typeof edit === "string");
  for (const { reference, edit } of blocked) {
    result.manual.push(
      site(
        filePath,
        reference,
        edit === "manual-type"
          ? `typeof ${ENV_CONSTANT}: use the return type of ${MERGED_FACTORY} by hand`
          : `${ENV_CONSTANT} is exported from this module: export ${MERGED_FACTORY} as well`,
      ),
    );
  }
  if (blocked.length > 0) return false;
  for (const { reference, edit } of planned) {
    if (typeof edit === "string") continue;
    edits.push(edit);
    result.rewrites.push(site(filePath, reference, `${ENV_CONSTANT} -> ${ENV_CALL}`));
  }
  return true;
}

function rewriteEnvFeature(source: string, filePath: string, result: SiteLists): string {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });
  const sourceFile = project.createSourceFile(filePath, source);
  const edits: TextEdit[] = [];
  const targetSpecifiers: EnvImportTarget[] = [];
  for (const declaration of sourceFile.getImportDeclarations()) {
    const replacement = envModuleReplacement(declaration.getModuleSpecifierValue(), filePath);
    if (replacement === undefined) continue;
    if (!planEnvDeclaration(declaration, filePath, edits, result)) continue;
    targetSpecifiers.push({ specifier: replacement, isTypeOnly: declaration.isTypeOnly() });
  }
  if (targetSpecifiers.length === 0) return source;

  const next = project.createSourceFile(`${filePath}.rewritten.ts`, applyEdits(source, edits));
  for (const { specifier, isTypeOnly } of targetSpecifiers) {
    const declaration = next
      .getImportDeclarations()
      .find((d) => d.getNamedImports().some((n) => n.getName() === ENV_CONSTANT));
    const named = declaration?.getNamedImports().find((n) => n.getName() === ENV_CONSTANT);
    if (declaration === undefined || named === undefined) continue;
    result.rewrites.push(
      site(filePath, named, `import ${ENV_CONSTANT} -> ${MERGED_FACTORY} from ${specifier}`),
    );
    removeNamedImport(next, declaration, named);
    if (!hasImportBinding(next, MERGED_FACTORY)) {
      ensureNamedImport(next, specifier, MERGED_FACTORY, isTypeOnly);
    }
  }
  return next.getFullText();
}

function reportEnvReexports(sourceFile: SourceFile, filePath: string, result: SiteLists): void {
  for (const declaration of sourceFile.getExportDeclarations()) {
    const specifier = declaration.getModuleSpecifierValue();
    if (specifier === undefined || envModuleReplacement(specifier, filePath) === undefined)
      continue;
    if (declaration.getNamedExports().some((e) => e.getName() === ENV_CONSTANT)) {
      result.manual.push(
        site(
          filePath,
          declaration,
          `${ENV_CONSTANT} re-exported from ${specifier}: re-export ${MERGED_FACTORY}`,
        ),
      );
    }
  }
}

export function transformS3ImportsSource(source: string, filePath = "source.ts"): CodemodResult {
  const result: SiteLists = { rewrites: [], manual: [] };
  if (!CHEAP_PREFILTER.test(source)) return { output: source, ...result };
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });
  const sourceFile = project.createSourceFile(filePath, source);
  reportEnvReexports(sourceFile, filePath, result);
  const libRewritten = rewriteLibSpecifiers(sourceFile, source, filePath, result);
  const output = rewriteEnvFeature(libRewritten, filePath, result);
  return { output, ...result };
}

function isSkippedPath(file: string): boolean {
  return SKIPPED_PATH_SUFFIXES.some((suffix) => file.endsWith(suffix));
}

if (import.meta.main) {
  await runCodemodCli(
    { name: "s3-imports", transform: transformS3ImportsSource, isSkippedPath },
    process.argv.slice(2),
  );
}
