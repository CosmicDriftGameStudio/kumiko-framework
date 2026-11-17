#!/usr/bin/env bun
// escape-hatch-grants — `escapeHatch: { reason }` on write and query handlers, hooks and jobs gets
// the `grants` it needs, read from the definition: `unsafeRaw(` unsafeRaw, `.global(` globalWrites,
// `crossTenantReads` crossTenantReads, `queryAs(`, `writeAs(`, `createSystemUser(`,
// `unsafeAllTenants` or `runAs` with SystemAdmin systemIdentity. A declaration without a readable
// signal is reported as manual. escapeHatch in r.applyExtension options stays `{ reason }`.
//
// Usage:
//   bun scripts/codemod/escape-hatch-grants.ts <targetDir...> [--check | --dry-run | --write] [--no-format]
// Without a mode flag it writes (kumiko-upgrade --apply calls it that way). --check exits 1
// while any rewritable or manual site is left; --dry-run only reports.

import { ESCAPE_HATCH_GRANTS, type EscapeHatchGrant } from "@cosmicdrift/kumiko-types/handlers";
import {
  type CallExpression,
  Node,
  type ObjectLiteralExpression,
  Project,
  type PropertyAssignment,
  type ShorthandPropertyAssignment,
  type SourceFile,
  SyntaxKind,
} from "ts-morph";
import {
  applyEdits,
  type CodemodResult,
  runCodemodCli,
  type SiteLists,
  type TextEdit,
} from "./codemod-support.ts";

const CHEAP_PREFILTER = /escapeHatch/;
const DEFINITION_CALLS: ReadonlySet<string> = new Set([
  "writeHandler",
  "queryHandler",
  "streamHandler",
  "hook",
  "job",
]);
const DEFINE_HANDLER_CALL = /^define\w*Handler$/;
const HANDLER_PROPERTIES: readonly string[] = ["handler", "run"];
const CONTEXT_NAME = "ctx";

const GRANT_SIGNALS: Readonly<Record<EscapeHatchGrant, (text: string) => boolean>> = {
  systemIdentity: (text) =>
    /\b(queryAs|writeAs|createSystemUser)\(|\bunsafeAllTenants\b/.test(text) ||
    (/\brunAs\b/.test(text) && /SystemAdmin/.test(text)),
  globalWrites: (text) => /\.global\(/.test(text),
  unsafeRaw: (text) => /\bunsafeRaw(AllTenants)?\(/.test(text),
  crossTenantReads: (text) => text.includes("crossTenantReads"),
};

type EscapeHatchProperty = PropertyAssignment | ShorthandPropertyAssignment;
type Inference = { readonly grants: readonly EscapeHatchGrant[] } | { readonly why: string };

function calleeName(call: CallExpression): string | undefined {
  const callee = call.getExpression();
  if (Node.isIdentifier(callee)) return callee.getText();
  if (Node.isPropertyAccessExpression(callee)) return callee.getName();
  return undefined;
}

function isDefinitionCall(call: CallExpression): boolean {
  const name = calleeName(call);
  return name !== undefined && (DEFINITION_CALLS.has(name) || DEFINE_HANDLER_CALL.test(name));
}

function importedNames(sourceFile: SourceFile): Set<string> {
  const names = new Set<string>();
  for (const declaration of sourceFile.getImportDeclarations()) {
    const defaultImport = declaration.getDefaultImport();
    if (defaultImport !== undefined) names.add(defaultImport.getText());
    const namespaceImport = declaration.getNamespaceImport();
    if (namespaceImport !== undefined) names.add(namespaceImport.getText());
    for (const named of declaration.getNamedImports()) {
      names.add(named.getAliasNode()?.getText() ?? named.getName());
    }
  }
  return names;
}

function rootIdentifier(expression: Node): string | undefined {
  let current = expression;
  while (Node.isPropertyAccessExpression(current)) current = current.getExpression();
  return Node.isIdentifier(current) ? current.getText() : undefined;
}

function handlerIdentifier(definition: ObjectLiteralExpression): string | undefined {
  for (const property of definition.getProperties()) {
    if (Node.isShorthandPropertyAssignment(property)) {
      if (HANDLER_PROPERTIES.includes(property.getName())) return property.getName();
    } else if (Node.isPropertyAssignment(property)) {
      const initializer = property.getInitializer();
      if (
        HANDLER_PROPERTIES.includes(property.getName()) &&
        initializer !== undefined &&
        Node.isIdentifier(initializer)
      ) {
        return initializer.getText();
      }
    }
  }
  return undefined;
}

// Same-file function the definition's handler/run points to; undefined when it is not declared here.
function localFunctionNamed(sourceFile: SourceFile, name: string): Node | undefined {
  const declared = sourceFile.getFunction(name);
  if (declared !== undefined) return declared;
  return sourceFile.getVariableDeclaration(name)?.getInitializer();
}

function inferGrants(
  sourceFile: SourceFile,
  definition: ObjectLiteralExpression,
  escapeHatch: EscapeHatchProperty,
): Inference {
  const source = sourceFile.getFullText();
  const imported = importedNames(sourceFile);
  const handlerName = handlerIdentifier(definition);
  const local = handlerName === undefined ? undefined : localFunctionNamed(sourceFile, handlerName);
  if (handlerName !== undefined && local === undefined && imported.has(handlerName)) {
    return {
      why: `grants not inferable: handler \`${handlerName}\` is imported, add grants by hand`,
    };
  }
  const text =
    source.slice(definition.getStart(), escapeHatch.getStart()) +
    source.slice(escapeHatch.getEnd(), definition.getEnd()) +
    (local === undefined ? "" : `\n${local.getText()}`);
  const calls = [
    ...definition.getDescendantsOfKind(SyntaxKind.CallExpression),
    ...(local?.getDescendantsOfKind(SyntaxKind.CallExpression) ?? []),
  ].filter((call) => !escapeHatch.containsRange(call.getPos(), call.getEnd()));
  const forwardsContext = calls.some((call) => {
    const root = rootIdentifier(call.getExpression());
    return (
      root !== undefined &&
      imported.has(root) &&
      call.getArguments().some((arg) => Node.isIdentifier(arg) && arg.getText() === CONTEXT_NAME)
    );
  });
  if (forwardsContext) {
    return {
      why: "grants not inferable: the handler passes ctx to an imported function, add grants by hand",
    };
  }
  const grants = ESCAPE_HATCH_GRANTS.filter((grant) => GRANT_SIGNALS[grant](text));
  if (grants.length === 0) {
    return {
      why: "grants not inferable: no unsafeRaw, global, crossTenantReads or system-identity call in the definition, add grants by hand",
    };
  }
  return { grants };
}

function insertionEdit(
  source: string,
  literal: ObjectLiteralExpression,
  grants: readonly EscapeHatchGrant[],
): TextEdit | undefined {
  const last = literal.getProperties().at(-1);
  if (last === undefined) return undefined;
  const list = `grants: [${grants.map((grant) => `"${grant}"`).join(", ")}]`;
  if (!literal.getText().includes("\n")) {
    return { start: last.getEnd(), end: last.getEnd(), text: `, ${list}` };
  }
  const lineStart = source.lastIndexOf("\n", last.getStart() - 1) + 1;
  const indent = source.slice(lineStart, last.getStart()).match(/^\s*/)?.[0] ?? "";
  return { start: last.getEnd(), end: last.getEnd(), text: `,\n${indent}${list}` };
}

function hasProperty(literal: ObjectLiteralExpression, name: string): boolean {
  return literal.getProperties().some((property) => {
    if (Node.isPropertyAssignment(property) || Node.isShorthandPropertyAssignment(property)) {
      return property.getName() === name;
    }
    return false;
  });
}

function visitEscapeHatch(
  sourceFile: SourceFile,
  property: EscapeHatchProperty,
  filePath: string,
  result: SiteLists,
  edits: TextEdit[],
): void {
  const definition = property.getParent();
  if (!Node.isObjectLiteralExpression(definition)) return;
  const call = definition.getFirstAncestorByKind(SyntaxKind.CallExpression);
  if (call === undefined || !isDefinitionCall(call)) return;
  const site = { file: filePath, line: property.getStartLineNumber() };
  const initializer = Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
  if (initializer === undefined || !Node.isObjectLiteralExpression(initializer)) {
    result.manual.push({
      ...site,
      description: "escapeHatch is not an object literal, add grants by hand",
    });
    return;
  }
  if (hasProperty(initializer, "grants")) return;
  if (initializer.getProperties().some((member) => Node.isSpreadAssignment(member))) {
    result.manual.push({
      ...site,
      description: "escapeHatch contains a spread, add grants by hand",
    });
    return;
  }
  if (!hasProperty(initializer, "reason")) {
    result.manual.push({
      ...site,
      description: "escapeHatch has no reason, add reason and grants by hand",
    });
    return;
  }
  const inferred = inferGrants(sourceFile, definition, property);
  if ("why" in inferred) {
    result.manual.push({ ...site, description: inferred.why });
    return;
  }
  const edit = insertionEdit(sourceFile.getFullText(), initializer, inferred.grants);
  if (edit === undefined) return;
  edits.push(edit);
  result.rewrites.push({ ...site, description: `grants: [${inferred.grants.join(", ")}]` });
}

export function transformEscapeHatchGrantsSource(source: string, filePath: string): CodemodResult {
  const result: SiteLists = { rewrites: [], manual: [] };
  if (!CHEAP_PREFILTER.test(source)) return { output: source, ...result };
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });
  const sourceFile = project.createSourceFile(filePath, source);
  const edits: TextEdit[] = [];
  for (const node of sourceFile.getDescendants()) {
    const isEscapeHatch =
      (Node.isPropertyAssignment(node) || Node.isShorthandPropertyAssignment(node)) &&
      node.getName() === "escapeHatch";
    if (isEscapeHatch) visitEscapeHatch(sourceFile, node, filePath, result, edits);
  }
  return { output: applyEdits(source, edits), ...result };
}

function isSkippedPath(file: string): boolean {
  return (
    file.includes("/__tests__/fixtures/") ||
    file.endsWith("packages/feature-ast/src/scripts/codemod/escape-hatch-grants.ts") ||
    file.endsWith("packages/feature-ast/src/__tests__/escape-hatch-grants-codemod.test.ts")
  );
}

if (import.meta.main) {
  await runCodemodCli(
    { name: "escape-hatch-grants", transform: transformEscapeHatchGrantsSource, isSkippedPath },
    process.argv.slice(2),
  );
}
