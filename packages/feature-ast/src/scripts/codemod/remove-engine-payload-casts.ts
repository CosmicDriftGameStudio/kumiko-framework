#!/usr/bin/env bun
// remove-engine-payload-casts — executor.detail()/list() now return the entity's own row type
// (EntityRow<E>), so casts that used to narrow the untyped Record are redundant. This removes
// `row as T` / `row["f"] as T` / `(await x.detail(...)) as unknown as T` (and the
// `@cast-boundary` marker of that cast) where the operand derives from an executor read AND
// the checker says its type is assignable to T. Casts the row type does not satisfy stay and
// are listed as manual. A file whose rewrite would add type errors is left untouched.
//
// Usage:
//   bun scripts/codemod/remove-engine-payload-casts.ts <targetDir...> [--check | --dry-run | --write] [--no-format]
//
// Needs a tsconfig.json at or above the target: the assignability check runs on the real
// program, so the framework version the app compiles against decides the row type.

import { dirname, resolve } from "node:path";
import { type AsExpression, Node, type Project, type SourceFile, SyntaxKind, ts } from "ts-morph";
import { type CodemodResult, runCodemodCli } from "./codemod-support.ts";
import { createTypeAwareProject } from "./type-aware-project.ts";

const CAST_MARKER = "@cast-boundary";
const EXECUTOR_TYPES_FILE = "/event-store-executor-types.ts";
const READ_VERBS: ReadonlySet<string> = new Set(["detail", "list"]);
const READ_CALL_PREFILTER = /\.(detail|list)\(/;
const CAST_PREFILTER = /\bas\s/;
const MAX_DERIVATION_DEPTH = 8;
const MAX_TYPE_TEXT_LENGTH = 120;

const SKIPPED_PATH_SUFFIXES: readonly string[] = [
  "packages/feature-ast/src/scripts/codemod/remove-engine-payload-casts.ts",
  "packages/feature-ast/src/__tests__/remove-engine-payload-casts-codemod.test.ts",
];

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

function stripWrappers(node: Node): Node {
  let current = node;
  for (;;) {
    if (Node.isParenthesizedExpression(current) || Node.isNonNullExpression(current)) {
      current = current.getExpression();
    } else if (Node.isAwaitExpression(current)) {
      current = current.getExpression();
    } else {
      return current;
    }
  }
}

function isCastTo(node: Node, keyword: SyntaxKind): boolean {
  return Node.isAsExpression(node) && node.getTypeNode()?.getKind() === keyword;
}

function isExecutorReadCall(node: Node): boolean {
  if (!Node.isCallExpression(node)) return false;
  const callee = node.getExpression();
  if (!Node.isPropertyAccessExpression(callee) || !READ_VERBS.has(callee.getName())) return false;
  const declarations = callee.getNameNode().getSymbol()?.getDeclarations() ?? [];
  return declarations.some((declaration) =>
    declaration.getSourceFile().getFilePath().endsWith(EXECUTOR_TYPES_FILE),
  );
}

// Follows property/element access, `??` / `||` and single-assignment variables back to an
// executor read. Anything else (parameters, callbacks, reassigned lets) is not recognised.
function derivesFromExecutorRead(node: Node, depth = 0): boolean {
  if (depth > MAX_DERIVATION_DEPTH) return false;
  const current = stripWrappers(node);
  if (Node.isCallExpression(current)) return isExecutorReadCall(current);
  if (Node.isPropertyAccessExpression(current) || Node.isElementAccessExpression(current)) {
    return derivesFromExecutorRead(current.getExpression(), depth + 1);
  }
  if (Node.isBinaryExpression(current)) {
    const operator = current.getOperatorToken().getKind();
    return (
      (operator === SyntaxKind.QuestionQuestionToken || operator === SyntaxKind.BarBarToken) &&
      derivesFromExecutorRead(current.getLeft(), depth + 1)
    );
  }
  if (Node.isIdentifier(current)) {
    const declarations = current.getDefinitionNodes();
    const declaration = declarations.length === 1 ? declarations[0] : undefined;
    if (declaration === undefined || !Node.isVariableDeclaration(declaration)) return false;
    const initializer = declaration.getInitializer();
    return initializer !== undefined && derivesFromExecutorRead(initializer, depth + 1);
  }
  return false;
}

function innermostOperand(cast: AsExpression): Node {
  let operand = cast.getExpression();
  while (isCastTo(stripParenthesesOnly(operand), SyntaxKind.UnknownKeyword)) {
    const inner = stripParenthesesOnly(operand);
    if (!Node.isAsExpression(inner)) break;
    operand = inner.getExpression();
  }
  return operand;
}

function stripParenthesesOnly(node: Node): Node {
  let current = node;
  while (Node.isParenthesizedExpression(current)) current = current.getExpression();
  return current;
}

function enclosingStatement(node: Node): Node | undefined {
  return node.getFirstAncestor((ancestor) => {
    const parent = ancestor.getParent();
    return (
      parent !== undefined &&
      (Node.isBlock(parent) ||
        Node.isSourceFile(parent) ||
        Node.isModuleBlock(parent) ||
        Node.isCaseClause(parent) ||
        Node.isDefaultClause(parent))
    );
  });
}

function isRemovableCastKind(cast: AsExpression): boolean {
  return !isCastTo(cast, SyntaxKind.ConstKeyword);
}

function remainingCasts(statement: Node, removed: ReadonlySet<Node>): number {
  return statement
    .getDescendantsOfKind(SyntaxKind.AsExpression)
    .filter((candidate) => isRemovableCastKind(candidate) && !removed.has(candidate)).length;
}

function lineEnd(text: string, from: number): number {
  const newline = text.indexOf("\n", from);
  return newline === -1 ? text.length : newline;
}

// The marker sits as trailing line comment of the cast's line or of the statement's last line,
// or as its own comment line(s) directly above the statement.
function markerEdits(source: string, statement: Node, cast: AsExpression): Edit[] {
  const edits: Edit[] = [];
  for (const from of new Set([cast.getEnd(), statement.getEnd()])) {
    const end = lineEnd(source, from);
    const rest = source.slice(from, end);
    const commentStart = rest.indexOf("//");
    if (commentStart === -1 || !rest.slice(commentStart).includes(CAST_MARKER)) continue;
    const start = from + commentStart;
    const spaces = /[ \t]*$/.exec(source.slice(0, start))?.[0].length ?? 0;
    edits.push({ start: start - spaces, end, text: "" });
  }
  for (const range of statement.getLeadingCommentRanges()) {
    if (!range.getText().includes(CAST_MARKER)) continue;
    const start = source.lastIndexOf("\n", range.getPos() - 1) + 1;
    const end = source[range.getEnd()] === "\n" ? range.getEnd() + 1 : range.getEnd();
    edits.push({ start, end, text: "" });
  }
  return edits;
}

function shortTypeText(text: string): string {
  const oneLine = text.replace(/\s+/g, " ");
  return oneLine.length <= MAX_TYPE_TEXT_LENGTH
    ? oneLine
    : `${oneLine.slice(0, MAX_TYPE_TEXT_LENGTH)}...`;
}

function applyEdits(source: string, edits: readonly Edit[]): string {
  const unique = new Map<number, Edit>();
  for (const edit of edits) unique.set(edit.start, edit);
  let output = source;
  for (const edit of [...unique.values()].sort((a, b) => b.start - a.start)) {
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  }
  return output;
}

function diagnosticCount(sourceFile: SourceFile): number {
  return sourceFile.getProject().getProgram().getSemanticDiagnostics(sourceFile).length;
}

function addsTypeErrors(sourceFile: SourceFile, source: string, output: string): boolean {
  const errorsBefore = diagnosticCount(sourceFile);
  sourceFile.replaceWithText(output);
  const errorsAfter = diagnosticCount(sourceFile);
  sourceFile.replaceWithText(source);
  return errorsAfter > errorsBefore;
}

function markerEditsForTouched(
  source: string,
  touchedStatements: ReadonlyMap<Node, readonly AsExpression[]>,
  removed: ReadonlySet<Node>,
): Edit[] {
  const edits: Edit[] = [];
  for (const [statement, casts] of touchedStatements) {
    const [first] = casts;
    if (first !== undefined && remainingCasts(statement, removed) === 0) {
      edits.push(...markerEdits(source, statement, first));
    }
  }
  return edits;
}

function skippedForTypeErrors(
  source: string,
  rewrites: CodemodResult["rewrites"],
  manual: CodemodResult["rewrites"],
): CodemodResult {
  return {
    output: source,
    rewrites: [],
    manual: [
      ...manual,
      ...rewrites.map((site) => ({
        ...site,
        description: `${site.description} — skipped: removing it adds type errors in this file`,
      })),
    ],
  };
}

export function transformEnginePayloadCastsFile(
  sourceFile: SourceFile,
  filePath: string,
): CodemodResult {
  const source = sourceFile.getFullText();
  const result: CodemodResult = { output: source, rewrites: [], manual: [] };
  const rewrites = [...result.rewrites];
  const manual = [...result.manual];
  const edits: Edit[] = [];
  const removed = new Set<Node>();
  const touchedStatements = new Map<Node, AsExpression[]>();

  for (const cast of sourceFile.getDescendantsOfKind(SyntaxKind.AsExpression)) {
    const typeNode = cast.getTypeNode();
    if (typeNode === undefined || !isRemovableCastKind(cast)) continue;
    if (isCastTo(cast, SyntaxKind.UnknownKeyword)) continue;
    const operand = innermostOperand(cast);
    if (!derivesFromExecutorRead(operand)) continue;
    const line = cast.getStartLineNumber();
    const operandType = operand.getType();
    if (!operandType.isAssignableTo(typeNode.getType())) {
      manual.push({
        file: filePath,
        line,
        description: `cast to ${shortTypeText(typeNode.getText())} kept: ${shortTypeText(operandType.getText(cast))} is not assignable to it`,
      });
      continue;
    }
    edits.push({ start: cast.getStart(), end: cast.getEnd(), text: operand.getText() });
    removed.add(cast);
    // The inner `as unknown` of a double cast disappears with the outer cast.
    for (const inner of cast.getDescendantsOfKind(SyntaxKind.AsExpression)) removed.add(inner);
    const statement = enclosingStatement(cast);
    if (statement !== undefined) {
      touchedStatements.set(statement, [...(touchedStatements.get(statement) ?? []), cast]);
    }
    rewrites.push({
      file: filePath,
      line,
      description: `removed cast to ${shortTypeText(typeNode.getText())}, the executor row type already satisfies it`,
    });
  }

  edits.push(...markerEditsForTouched(source, touchedStatements, removed));

  if (edits.length === 0) return { output: source, rewrites, manual };

  const output = applyEdits(source, edits);
  if (addsTypeErrors(sourceFile, source, output)) {
    return skippedForTypeErrors(source, rewrites, manual);
  }
  return { output, rewrites, manual };
}

const projectsByTsconfig = new Map<string, Project>();

function projectFor(filePath: string): Project | undefined {
  const tsconfig = ts.findConfigFile(dirname(resolve(filePath)), ts.sys.fileExists);
  if (tsconfig === undefined) return undefined;
  const cached = projectsByTsconfig.get(tsconfig);
  if (cached !== undefined) return cached;
  const project = createTypeAwareProject(tsconfig);
  projectsByTsconfig.set(tsconfig, project);
  return project;
}

// `project` decides which program answers the assignability question; without one the tsconfig
// next to the file is used. A file without any tsconfig is reported as manual, not guessed at.
export function transformEnginePayloadCastsSource(
  source: string,
  filePath = "source.ts",
  project?: Project,
): CodemodResult {
  const unchanged: CodemodResult = { output: source, rewrites: [], manual: [] };
  if (!READ_CALL_PREFILTER.test(source) || !CAST_PREFILTER.test(source)) return unchanged;
  const absolutePath = resolve(filePath);
  const program = project ?? projectFor(absolutePath);
  if (program === undefined) {
    return {
      ...unchanged,
      manual: [
        { file: filePath, line: 1, description: "no tsconfig.json found, cannot type-check" },
      ],
    };
  }
  const sourceFile = program.createSourceFile(absolutePath, source, { overwrite: true });
  return transformEnginePayloadCastsFile(sourceFile, filePath);
}

if (import.meta.main) {
  await runCodemodCli(
    {
      name: "remove-engine-payload-casts",
      transform: (source, filePath) => transformEnginePayloadCastsSource(source, filePath),
      isSkippedPath: (file) => SKIPPED_PATH_SUFFIXES.some((suffix) => file.endsWith(suffix)),
    },
    process.argv.slice(2),
  );
}
