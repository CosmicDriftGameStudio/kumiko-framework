#!/usr/bin/env bun
// scaffold-kms-mode — brings apps scaffolded before kumiko-framework 0.416.0 in line with the
// current scaffold, so production boots accept `*_CIPHERTEXT` Key Manager keys:
//   bin/main.ts   requireKmsWiring(process.env, opts)   -> { kmsMode: "required" as const }
//   bin/kumiko.ts kmsSlotsOf(envSchema.schema)          -> union with kmsSlotsOf(kmsEnvSchema)
// Only the exact scaffold shape is rewritten; a hand-edited file is reported as manual.
//
// Usage:
//   bun scripts/codemod/scaffold-kms-mode.ts <targetDir...> [--check | --dry-run | --write] [--no-format]

import { Node, Project, type SourceFile, SyntaxKind } from "ts-morph";
import {
  applyEdits,
  type CodemodResult,
  type CodemodSite,
  hasImportBinding,
  removeNamedImport,
  runCodemodCli,
  type SiteLists,
  type TextEdit,
} from "./codemod-support.ts";

const MAIN_FILE_SUFFIX = "/bin/main.ts";
const CLI_FILE_SUFFIX = "/bin/kumiko.ts";
const PRODUCTION_CONDITION = 'process.env["NODE_ENV"] === "production"';
const REQUIRED_KMS_MODE = '{ kmsMode: "required" as const }';
const OLD_SLOTS_INITIALIZER = "kmsSlotsOf(envSchema.schema)";
const NEW_SLOTS_INITIALIZER =
  "[...new Set([...kmsSlotsOf(envSchema.schema), ...kmsSlotsOf(kmsEnvSchema)])]";
const SLOTS_COMMENT =
  "// bin/main.ts boots with kmsMode, which resolves the slots of kmsEnvSchema; the migrate step needs the same keys.";
const KMS_ENV_SPECIFIER = "@cosmicdrift/kumiko-bundled-features/crypto-shredding/env";

const CHEAP_PREFILTER = /requireKmsWiring|kmsSlotsOf/;

function parse(source: string, filePath: string): SourceFile {
  return new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  }).createSourceFile(filePath, source);
}

function site(file: string, node: Node, description: string): CodemodSite {
  return { file, line: node.getStartLineNumber(), description };
}

function transformMain(source: string, filePath: string, result: SiteLists): string {
  const sourceFile = parse(source, filePath);
  const productionBranches = sourceFile
    .getDescendantsOfKind(SyntaxKind.ConditionalExpression)
    .filter((conditional) => conditional.getCondition().getText() === PRODUCTION_CONDITION)
    .map((conditional) => conditional.getWhenTrue())
    .filter(
      (branch) =>
        Node.isCallExpression(branch) && branch.getExpression().getText() === "requireKmsWiring",
    );
  const [branch] = productionBranches;
  const usageCount = sourceFile
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .filter((identifier) => identifier.getText() === "requireKmsWiring").length;
  const importDeclaration = sourceFile
    .getImportDeclarations()
    .find((declaration) =>
      declaration.getNamedImports().some((n) => n.getName() === "requireKmsWiring"),
    );
  const importSpecifier = importDeclaration
    ?.getNamedImports()
    .find((n) => n.getName() === "requireKmsWiring");
  // import + the one production call: anything else is hand-written code this codemod must not guess at.
  const isScaffoldShape =
    productionBranches.length === 1 &&
    branch !== undefined &&
    Node.isCallExpression(branch) &&
    branch.getArguments()[0]?.getText() === "process.env" &&
    importSpecifier !== undefined &&
    importSpecifier.getAliasNode() === undefined &&
    usageCount === 2;
  if (!isScaffoldShape || importDeclaration === undefined) {
    const stray = sourceFile
      .getDescendantsOfKind(SyntaxKind.Identifier)
      .find((identifier) => identifier.getText() === "requireKmsWiring");
    if (stray !== undefined) {
      result.manual.push(
        site(
          filePath,
          stray,
          `requireKmsWiring does not match the scaffold: pass kmsMode: "required" to runProdApp in production`,
        ),
      );
    }
    return source;
  }

  result.rewrites.push(site(filePath, branch, `requireKmsWiring(...) -> ${REQUIRED_KMS_MODE}`));
  const replaced = parse(
    applyEdits(source, [
      { start: branch.getStart(), end: branch.getEnd(), text: REQUIRED_KMS_MODE },
    ]),
    filePath,
  );
  const declaration = replaced
    .getImportDeclarations()
    .find((d) => d.getNamedImports().some((n) => n.getName() === "requireKmsWiring"));
  const named = declaration?.getNamedImports().find((n) => n.getName() === "requireKmsWiring");
  if (declaration !== undefined && named !== undefined) {
    removeNamedImport(replaced, declaration, named);
  }
  return replaced.getFullText();
}

function insertKmsEnvImport(sourceFile: SourceFile): TextEdit {
  const declarations = sourceFile.getImportDeclarations();
  const next = declarations.find((d) => d.getModuleSpecifierValue() > KMS_ENV_SPECIFIER);
  const line = `import { kmsEnvSchema } from "${KMS_ENV_SPECIFIER}";`;
  if (next !== undefined) {
    return { start: next.getStart(), end: next.getStart(), text: `${line}\n` };
  }
  const last = declarations[declarations.length - 1];
  const at = last === undefined ? 0 : last.getEnd();
  return { start: at, end: at, text: last === undefined ? `${line}\n` : `\n${line}` };
}

function transformCli(source: string, filePath: string, result: SiteLists): string {
  const sourceFile = parse(source, filePath);
  const declarations = sourceFile
    .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
    .filter((declaration) => declaration.getName() === "kmsSlots");
  const [declaration] = declarations;
  const statement = declaration?.getVariableStatement();
  const slotsOfImported = sourceFile
    .getImportDeclarations()
    .some(
      (d) =>
        d.getModuleSpecifierValue() === "@cosmicdrift/kumiko-framework/env" &&
        d.getNamedImports().some((n) => n.getName() === "kmsSlotsOf"),
    );
  const isScaffoldShape =
    declarations.length === 1 &&
    declaration !== undefined &&
    statement !== undefined &&
    declaration.getInitializer()?.getText() === OLD_SLOTS_INITIALIZER &&
    slotsOfImported &&
    !hasImportBinding(sourceFile, "kmsEnvSchema");
  if (!isScaffoldShape) {
    const unmigrated = sourceFile
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .find((call) => call.getText() === OLD_SLOTS_INITIALIZER);
    if (unmigrated !== undefined && !hasImportBinding(sourceFile, "kmsEnvSchema")) {
      result.manual.push(
        site(
          filePath,
          unmigrated,
          `kmsSlots does not match the scaffold: add kmsSlotsOf(kmsEnvSchema) from ${KMS_ENV_SPECIFIER}`,
        ),
      );
    }
    return source;
  }

  result.rewrites.push(
    site(
      filePath,
      statement,
      `kmsSlotsOf(envSchema.schema) -> union with kmsSlotsOf(kmsEnvSchema)`,
    ),
  );
  const indent = source.slice(statement.getStartLinePos(), statement.getStart());
  return applyEdits(source, [
    {
      start: declaration.getInitializerOrThrow().getStart(),
      end: declaration.getInitializerOrThrow().getEnd(),
      text: NEW_SLOTS_INITIALIZER,
    },
    { start: statement.getStart(), end: statement.getStart(), text: `${SLOTS_COMMENT}\n${indent}` },
    insertKmsEnvImport(sourceFile),
  ]);
}

const normalizedPath = (file: string): string => file.replaceAll("\\", "/");

export function transformScaffoldKmsModeSource(source: string, filePath: string): CodemodResult {
  const result: SiteLists = { rewrites: [], manual: [] };
  if (!CHEAP_PREFILTER.test(source)) return { output: source, ...result };
  const normalized = normalizedPath(filePath);
  if (normalized.endsWith(MAIN_FILE_SUFFIX)) {
    return { output: transformMain(source, filePath, result), ...result };
  }
  if (normalized.endsWith(CLI_FILE_SUFFIX)) {
    return { output: transformCli(source, filePath, result), ...result };
  }
  return { output: source, ...result };
}

function isSkippedPath(file: string): boolean {
  const normalized = normalizedPath(file);
  return !(normalized.endsWith(MAIN_FILE_SUFFIX) || normalized.endsWith(CLI_FILE_SUFFIX));
}

if (import.meta.main) {
  await runCodemodCli(
    { name: "scaffold-kms-mode", transform: transformScaffoldKmsModeSource, isSkippedPath },
    process.argv.slice(2),
  );
}
