#!/usr/bin/env bun
// import-extensions — relative imports name the TypeScript source file:
//   import { x } from "./foo.js"   -> "./foo.ts"
//   import { C } from "./Comp.jsx" -> "./Comp.tsx"
// Covers import/export ... from, import type, import("..."), import types and mock.module. A site
// is rewritten only when the target file exists with the new extension next to the importer;
// otherwise it is reported as manual and left alone.
//
// Needs `allowImportingTsExtensions` and `rewriteRelativeImportExtensions` in the tsconfig that
// compiles the code, otherwise tsc rejects the `.ts` specifiers.
//
// Usage:
//   bun scripts/codemod/import-extensions.ts <targetDir...> [--check | --dry-run | --write] [--no-format]
// Without a mode flag it writes (kumiko-upgrade --apply calls it that way). --check exits 1
// while any rewritable or manual site is left; --dry-run only reports.

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Node, Project, SyntaxKind } from "ts-morph";
import { type CodemodResult, runCodemodCli, type SiteLists } from "./codemod-support.ts";

const CHEAP_PREFILTER = /\.jsx?["'`]/;

const RELATIVE_JS_SPECIFIER = /^(\.{1,2}\/.*)\.(jsx?)$/;

function candidateExtensions(oldExtension: string): readonly string[] {
  return oldExtension === "jsx" ? ["tsx"] : ["ts", "tsx"];
}

function sourceExtensionFor(
  importerPath: string,
  base: string,
  oldExtension: string,
): string | undefined {
  return candidateExtensions(oldExtension).find((extension) =>
    existsSync(resolve(dirname(importerPath), `${base}.${extension}`)),
  );
}

interface TextEdit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

function specifierLiterals(project: Project, source: string, filePath: string): Node[] {
  const sourceFile = project.createSourceFile(filePath, source, { overwrite: true });
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
    const first = call.getArguments()[0];
    if (isModuleLoad && first !== undefined && Node.isStringLiteral(first)) literals.push(first);
  }
  return literals;
}

export function transformImportExtensionsSource(
  source: string,
  filePath = "source.ts",
): CodemodResult {
  const result: SiteLists = { rewrites: [], manual: [] };
  if (!CHEAP_PREFILTER.test(source)) return { output: source, ...result };
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });
  const edits: TextEdit[] = [];
  for (const literal of specifierLiterals(project, source, filePath)) {
    if (!Node.isStringLiteral(literal) && !Node.isNoSubstitutionTemplateLiteral(literal)) continue;
    const current = literal.getLiteralValue();
    const match = RELATIVE_JS_SPECIFIER.exec(current);
    if (match === null) continue;
    const [, base = "", oldExtension = ""] = match;
    const line = literal.getStartLineNumber();
    const newExtension = sourceExtensionFor(filePath, base, oldExtension);
    if (newExtension === undefined) {
      result.manual.push({
        file: filePath,
        line,
        description: `${current}: no .${candidateExtensions(oldExtension).join("/.")} file next to the importer`,
      });
      continue;
    }
    const next = `${base}.${newExtension}`;
    result.rewrites.push({ file: filePath, line, description: `${current} -> ${next}` });
    edits.push({ start: literal.getStart() + 1, end: literal.getEnd() - 1, text: next });
  }
  let output = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  }
  return { output, ...result };
}

if (import.meta.main) {
  await runCodemodCli(
    {
      name: "import-extensions",
      transform: transformImportExtensionsSource,
      isSkippedPath: () => false,
    },
    process.argv.slice(2),
  );
}
