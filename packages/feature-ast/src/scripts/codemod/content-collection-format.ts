#!/usr/bin/env bun
// content-collection-format — the editor format of a content collection is "plain" or "document":
//   createTemplateResolverFeature({ collections: [{ contentFormat: "rich" | "markdown" }] })
//   r.contentCollection({ contentFormat: "rich" | "markdown" })   ->   contentFormat: "document"
// Only collection declarations are touched. Record storage literals (`contentFormat: "markdown"`
// in write payloads, seeds, upserts) use a different vocabulary and stay unchanged.
//
// Usage:
//   bun scripts/codemod/content-collection-format.ts <targetDir...> [--check | --dry-run | --write] [--no-format]

import { Node, type ObjectLiteralExpression, Project, SyntaxKind } from "ts-morph";
import {
  applyEdits,
  type CodemodResult,
  runCodemodCli,
  type SiteLists,
  type TextEdit,
} from "./codemod-support.ts";

const CHEAP_PREFILTER = /contentCollection|createTemplateResolverFeature/;
const LEGACY_EDITOR_FORMATS: ReadonlySet<string> = new Set(["rich", "markdown"]);

function firstObjectArgument(call: Node): ObjectLiteralExpression | undefined {
  if (!Node.isCallExpression(call)) return undefined;
  const first = call.getArguments()[0];
  return first !== undefined && Node.isObjectLiteralExpression(first) ? first : undefined;
}

function collectionDeclarations(call: Node): ObjectLiteralExpression[] {
  const callee = call.asKind(SyntaxKind.CallExpression)?.getExpression().getText();
  if (callee === undefined) return [];
  if (callee === "createTemplateResolverFeature") {
    const collections = firstObjectArgument(call)?.getProperty("collections");
    const array = collections?.asKind(SyntaxKind.PropertyAssignment)?.getInitializer();
    if (array === undefined || !Node.isArrayLiteralExpression(array)) return [];
    return array.getElements().filter(Node.isObjectLiteralExpression);
  }
  if (callee.endsWith(".contentCollection")) {
    const declaration = firstObjectArgument(call);
    return declaration === undefined ? [] : [declaration];
  }
  return [];
}

export function transformContentCollectionFormatSource(
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
  const sourceFile = project.createSourceFile(filePath, source, { overwrite: true });
  const edits: TextEdit[] = [];
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    for (const declaration of collectionDeclarations(call)) {
      const property = declaration
        .getProperty("contentFormat")
        ?.asKind(SyntaxKind.PropertyAssignment);
      const value = property?.getInitializer();
      if (value === undefined || !Node.isStringLiteral(value)) continue;
      const current = value.getLiteralValue();
      if (!LEGACY_EDITOR_FORMATS.has(current)) continue;
      result.rewrites.push({
        file: filePath,
        line: value.getStartLineNumber(),
        description: `contentFormat "${current}" -> "document"`,
      });
      edits.push({ start: value.getStart() + 1, end: value.getEnd() - 1, text: "document" });
    }
  }
  return { output: applyEdits(source, edits), ...result };
}

if (import.meta.main) {
  await runCodemodCli(
    {
      name: "content-collection-format",
      transform: transformContentCollectionFormatSource,
      isSkippedPath: () => false,
    },
    process.argv.slice(2),
  );
}
