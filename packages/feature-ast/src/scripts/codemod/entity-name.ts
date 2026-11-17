#!/usr/bin/env bun
// entity-name — an entity carries its name. The name moves from `r.entity({ name, ...entity })`,
// `r.crud("name", entity)`, `createEntityExecutor("name", entity)`, `buildEntityTable("name", entity)`
// and `deriveEntityTableMeta("name", entity)` into the entity's `createEntity({ name, ... })` call.
// An entity used under a second name becomes `{ ...entity, name: "other" }` at that site.
//
// Two passes over the project: the first collects the names per declaration through symbol
// resolution (also across files), the second writes `name` into the declaration and rewrites the call
// sites. Run it on a directory that holds both the entity declarations and their uses.
//
// The declaration is a createEntity call or a same-file const object literal, reached through
// `as`/`satisfies`, aliases and single-return factory functions; an inline `createEntity({...})` or
// object literal at the call site carries the name itself. Names given as constants are resolved by
// their string literal type. A site whose entity does not resolve to a declaration becomes
// `{ ...entity, name: X }`. Safe to run again over a partly migrated tree.
//
// Usage:
//   bun scripts/codemod/entity-name.ts <targetDir...> [--check | --dry-run | --write] [--no-format]
// Without a mode flag it writes (kumiko-upgrade --apply calls it that way). --check exits 1
// while any rewritable or manual site is left; --dry-run only reports.

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  type CallExpression,
  Node,
  type ObjectLiteralExpression,
  type Project,
  type SourceFile,
  SyntaxKind,
  type Type,
  VariableDeclarationKind,
} from "ts-morph";
import {
  applyEdits,
  type CodemodResult,
  type CodemodSite,
  runCodemodCli,
  type TextEdit,
} from "./codemod-support.ts";
import { collectSourceFiles } from "./collect-source-files.ts";
import { isUnresolvedRegistrarLookalike, resolveReceiver } from "./registrar-receiver.ts";
import { createTypeAwareProject } from "./type-aware-project.ts";

const CHEAP_PREFILTER =
  /\b(createEntity|createEntityExecutor|buildEntityTable|deriveEntityTableMeta|entity|crud)\b/;
const NAME_FIRST_FUNCTIONS: ReadonlySet<string> = new Set([
  "createEntityExecutor",
  "buildEntityTable",
  "deriveEntityTableMeta",
]);
const CREATE_ENTITY = "createEntity";
const MAX_RESOLUTION_DEPTH = 6;
const NAME_NOT_LITERAL =
  "name is not a string literal and has no single string literal type, move the name by hand";

interface Usage {
  readonly call: CallExpression;
  readonly label: string;
  readonly nameExpression: Node;
  // Undefined when neither a literal nor the type checker pins the name to one string.
  readonly nameValue: string | undefined;
  readonly carrier: ObjectLiteralExpression;
  // The carrier sits inside the call itself, so every name in scope at the call is in scope there.
  readonly isInline: boolean;
  // Builds the replacement once the canonical name of the entity is known.
  readonly edits: (canonicalName: string) => TextEdit[];
}

// Where a name lands: the object literal of a createEntity call, or a same-file const literal.
interface NameCarrier {
  readonly literal: ObjectLiteralExpression;
  readonly isCreateEntityArgument: boolean;
}

function isStringish(node: Node): boolean {
  return Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node);
}

function literalText(node: Node): string | undefined {
  return Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)
    ? node.getLiteralText()
    : undefined;
}

function quoted(name: string): string {
  return JSON.stringify(name);
}

// A literal, else the single string literal type the checker gives the expression (`const X = "a"`).
function nameValueOf(node: Node): string | undefined {
  const text = literalText(node);
  if (text !== undefined) return text;
  const type = node.getType();
  if (!type.isStringLiteral()) return undefined;
  const value = type.getLiteralValue();
  return typeof value === "string" ? value : undefined;
}

function isStringLikeType(type: Type): boolean {
  return (
    type.isString() ||
    type.isStringLiteral() ||
    (type.isUnion() && type.getUnionTypes().every((member) => member.isStringLiteral()))
  );
}

function unwrapExpression(node: Node): Node {
  let current = node;
  for (;;) {
    if (
      Node.isParenthesizedExpression(current) ||
      Node.isAsExpression(current) ||
      Node.isSatisfiesExpression(current) ||
      Node.isNonNullExpression(current) ||
      Node.isTypeAssertion(current)
    ) {
      current = current.getExpression();
    } else {
      return current;
    }
  }
}

function calleeNameOf(call: CallExpression): string | undefined {
  const callee = call.getExpression();
  if (Node.isIdentifier(callee)) return callee.getText();
  if (Node.isPropertyAccessExpression(callee)) return callee.getName();
  return undefined;
}

function isRegistrarCall(call: CallExpression): boolean {
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return false;
  const receiver = callee.getExpression();
  return resolveReceiver(receiver) === "registrar" || isUnresolvedRegistrarLookalike(receiver);
}

function declarationsOf(identifier: Node): Node[] {
  if (!Node.isIdentifier(identifier)) return [];
  let symbol = identifier.getSymbol();
  if (symbol?.isAlias()) symbol = symbol.getAliasedSymbol();
  return symbol?.getDeclarations() ?? [];
}

function isInsideFunctionLike(node: Node): boolean {
  return (
    Node.isFunctionDeclaration(node) ||
    Node.isArrowFunction(node) ||
    Node.isFunctionExpression(node) ||
    Node.isMethodDeclaration(node)
  );
}

// The one expression a helper function returns, when it has exactly one return.
function returnedExpressionOf(call: CallExpression): Node | undefined {
  for (const declaration of declarationsOf(call.getExpression())) {
    const fn = Node.isVariableDeclaration(declaration)
      ? declaration.getInitializer()
      : Node.isFunctionDeclaration(declaration)
        ? declaration
        : undefined;
    if (fn === undefined) continue;
    if (Node.isArrowFunction(fn) && !Node.isBlock(fn.getBody())) return fn.getBody();
    if (
      !Node.isArrowFunction(fn) &&
      !Node.isFunctionExpression(fn) &&
      !Node.isFunctionDeclaration(fn)
    ) {
      continue;
    }
    const returns = fn
      .getDescendantsOfKind(SyntaxKind.ReturnStatement)
      .filter((statement) => statement.getFirstAncestor(isInsideFunctionLike) === fn);
    const only = returns.length === 1 ? returns[0]?.getExpression() : undefined;
    if (only !== undefined) return only;
  }
  return undefined;
}

function isConstDeclaration(declaration: Node): boolean {
  return (
    Node.isVariableDeclaration(declaration) &&
    declaration.getVariableStatement()?.getDeclarationKind() === VariableDeclarationKind.Const
  );
}

function createEntityLiteralOf(call: CallExpression): ObjectLiteralExpression | undefined {
  const arg = call.getArguments()[0];
  return arg !== undefined && Node.isObjectLiteralExpression(arg) ? arg : undefined;
}

// The literal an entity expression ends up at: through imports, aliases, `as`/`satisfies` and
// single-return factories. A plain object literal only counts as a const of the same file.
function resolveNameCarrier(
  expression: Node,
  usageFile: SourceFile,
  depth = 0,
): NameCarrier | undefined {
  if (depth > MAX_RESOLUTION_DEPTH) return undefined;
  const node = unwrapExpression(expression);
  if (Node.isObjectLiteralExpression(node)) {
    return { literal: node, isCreateEntityArgument: false };
  }
  if (Node.isCallExpression(node)) {
    if (calleeNameOf(node) === CREATE_ENTITY) {
      const literal = createEntityLiteralOf(node);
      return literal === undefined ? undefined : { literal, isCreateEntityArgument: true };
    }
    const returned = returnedExpressionOf(node);
    return returned === undefined ? undefined : resolveNameCarrier(returned, usageFile, depth + 1);
  }
  if (!Node.isIdentifier(node)) return undefined;
  for (const declaration of declarationsOf(node)) {
    if (!Node.isVariableDeclaration(declaration)) continue;
    const initializer = declaration.getInitializer();
    if (initializer === undefined) continue;
    const carrier = resolveNameCarrier(initializer, usageFile, depth + 1);
    if (carrier === undefined) continue;
    const isSameFileConst =
      isConstDeclaration(declaration) && carrier.literal.getSourceFile() === usageFile;
    if (carrier.isCreateEntityArgument || isSameFileConst) return carrier;
  }
  return undefined;
}

// Whether the carrier, which sits at module level or in the call, can name `expression` itself.
function isVisibleAtCarrier(expression: Node, literal: ObjectLiteralExpression): boolean {
  if (expression.getSourceFile() !== literal.getSourceFile()) return false;
  let root = expression;
  while (Node.isPropertyAccessExpression(root)) root = root.getExpression();
  if (!Node.isIdentifier(root)) return false;
  const declarations = root.getSymbol()?.getDeclarations() ?? [];
  return (
    declarations.length > 0 &&
    declarations.every((declaration) => {
      if (
        Node.isImportSpecifier(declaration) ||
        Node.isImportClause(declaration) ||
        Node.isNamespaceImport(declaration)
      ) {
        return true;
      }
      const statement = Node.isVariableDeclaration(declaration)
        ? declaration.getVariableStatement()
        : Node.isEnumDeclaration(declaration)
          ? declaration
          : undefined;
      return (
        statement !== undefined &&
        Node.isSourceFile(statement.getParent()) &&
        declaration.getEnd() <= literal.getStart()
      );
    })
  );
}

function insertedNameText(usage: Usage): string {
  const isCopyable =
    !isStringish(usage.nameExpression) &&
    (usage.isInline || isVisibleAtCarrier(usage.nameExpression, usage.carrier));
  return isCopyable ? usage.nameExpression.getText() : quoted(usage.nameValue ?? "");
}

function isInside(inner: Node, outer: Node): boolean {
  return (
    inner.getSourceFile() === outer.getSourceFile() &&
    inner.getStart() >= outer.getStart() &&
    inner.getEnd() <= outer.getEnd()
  );
}

class Collector {
  readonly usages: Usage[] = [];
  readonly manual: CodemodSite[] = [];
  readonly directEdits: TextEdit[] = [];
  readonly directRewrites: CodemodSite[] = [];

  constructor(
    private readonly file: string,
    private readonly sourceFile: SourceFile,
  ) {}

  private fail(node: Node, description: string): void {
    this.manual.push({ file: this.file, line: node.getStartLineNumber(), description });
  }

  // One site, whatever its shape: the entity expression either resolves to a name carrier (grouped
  // per carrier in the second pass) or is rewritten on the spot to `{ ...entity, name: X }`.
  private register(
    call: CallExpression,
    label: string,
    nameExpression: Node,
    entityExpression: Node,
    edits: (retainName: boolean) => TextEdit[],
  ): void {
    const nameValue = nameValueOf(nameExpression);
    const carrier = resolveNameCarrier(entityExpression, this.sourceFile);
    if (carrier === undefined) {
      this.directEdits.push(...edits(true));
      this.directRewrites.push({
        file: this.file,
        line: call.getStartLineNumber(),
        description: `${label}: site form, declaration not resolved`,
      });
      return;
    }
    this.usages.push({
      call,
      label,
      nameExpression,
      nameValue,
      carrier: carrier.literal,
      isInline: isInside(carrier.literal, call),
      edits: (canonicalName) => edits(nameValue !== canonicalName),
    });
  }

  // The first argument is a name, not an entity: a string, or an expression the checker types as one.
  private isNameArgument(nameArg: Node, entityArg: Node): boolean {
    if (isStringish(nameArg)) return true;
    const type = nameArg.getType();
    if (isStringLikeType(type)) return true;
    return (
      type.isAny() &&
      resolveNameCarrier(entityArg, this.sourceFile)?.isCreateEntityArgument === true
    );
  }

  // createEntityExecutor / buildEntityTable / deriveEntityTableMeta / r.crud
  collectPositional(call: CallExpression, label: string): void {
    const [nameArg, entityArg] = call.getArguments();
    if (nameArg === undefined || entityArg === undefined) return;
    if (!this.isNameArgument(nameArg, entityArg)) return;
    if (
      nameValueOf(nameArg) === undefined &&
      resolveNameCarrier(entityArg, this.sourceFile) !== undefined
    ) {
      this.fail(call, `${label}: ${NAME_NOT_LITERAL}`);
      return;
    }
    this.register(call, label, nameArg, entityArg, (retainName) =>
      retainName
        ? [
            { start: nameArg.getStart(), end: entityArg.getStart(), text: "{ ..." },
            {
              start: entityArg.getEnd(),
              end: entityArg.getEnd(),
              text: `, name: ${nameArg.getText()} }`,
            },
          ]
        : [{ start: nameArg.getStart(), end: entityArg.getStart(), text: "" }],
    );
  }

  // r.entity({ name: X, ...entity [, other props] }); the new form spreads first.
  collectEntityCall(call: CallExpression): void {
    const label = "r.entity";
    const arg = call.getArguments()[0];
    if (arg === undefined || !Node.isObjectLiteralExpression(arg)) return;
    const members = arg.getProperties();
    const spreads = members.filter((member) => Node.isSpreadAssignment(member));
    const nameIndex = members.findIndex(
      (member) =>
        (Node.isPropertyAssignment(member) || Node.isShorthandPropertyAssignment(member)) &&
        member.getName() === "name",
    );
    const spread = spreads[0];
    if (spread === undefined || !Node.isSpreadAssignment(spread) || nameIndex === -1) return;
    if (nameIndex > members.indexOf(spread)) return;
    if (spreads.length > 1) {
      this.fail(call, `${label}: the literal spreads more than one entity`);
      return;
    }
    const nameMember = members[nameIndex];
    if (nameMember === undefined) return;
    const nameExpression = Node.isPropertyAssignment(nameMember)
      ? nameMember.getInitializer()
      : Node.isShorthandPropertyAssignment(nameMember)
        ? nameMember.getNameNode()
        : undefined;
    if (nameExpression === undefined) return;
    const entityExpression = spread.getExpression();
    if (
      nameValueOf(nameExpression) === undefined &&
      resolveNameCarrier(entityExpression, this.sourceFile) !== undefined
    ) {
      this.fail(call, `${label}: ${NAME_NOT_LITERAL}`);
      return;
    }
    const others = members
      .filter((member) => member !== nameMember && member !== spread)
      .map((member) => member.getText());
    this.register(call, label, nameExpression, entityExpression, (retainName) => {
      const parts = retainName ? [nameMember.getText(), ...others] : others;
      return [
        {
          start: arg.getStart(),
          end: entityExpression.getStart(),
          text: parts.length === 0 ? "" : "{ ...",
        },
        {
          start: entityExpression.getEnd(),
          end: arg.getEnd(),
          text: parts.length === 0 ? "" : `, ${parts.join(", ")} }`,
        },
      ];
    });
  }

  collect(): void {
    for (const call of this.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const name = calleeNameOf(call);
      if (name === undefined) continue;
      if (name === "entity" && isRegistrarCall(call)) this.collectEntityCall(call);
      else if (name === "crud" && isRegistrarCall(call)) this.collectPositional(call, "r.crud");
      else if (NAME_FIRST_FUNCTIONS.has(name)) this.collectPositional(call, name);
    }
  }
}

// A name a spread already brings along has to stay in place, so a new one goes after the spreads.
function nameInsertion(literal: ObjectLiteralExpression, nameText: string): TextEdit {
  const properties = literal.getProperties();
  const first = properties[0];
  const last = properties[properties.length - 1];
  if (first === undefined || last === undefined) {
    return { start: literal.getStart(), end: literal.getEnd(), text: `{ name: ${nameText} }` };
  }
  if (properties.some((property) => Node.isSpreadAssignment(property))) {
    return { start: last.getEnd(), end: last.getEnd(), text: `, name: ${nameText}` };
  }
  const text = literal.getSourceFile().getFullText();
  const lineStart = text.lastIndexOf("\n", first.getStart() - 1) + 1;
  const indent = text.slice(lineStart, first.getStart()).match(/^\s*/)?.[0] ?? "";
  const separator = literal.getText().includes("\n") ? `\n${indent}` : " ";
  return {
    start: first.getStart(),
    end: first.getStart(),
    text: `name: ${nameText},${separator}`,
  };
}

interface FileResult {
  readonly edits: TextEdit[];
  readonly rewrites: CodemodSite[];
  readonly manual: CodemodSite[];
}

type FileResults = Map<string, FileResult>;

function resultsFor(results: FileResults, file: string): FileResult {
  const existing = results.get(file);
  if (existing !== undefined) return existing;
  const created: FileResult = { edits: [], rewrites: [], manual: [] };
  results.set(file, created);
  return created;
}

function groupByCarrier(usages: readonly Usage[]): Map<string, Usage[]> {
  const groups = new Map<string, Usage[]>();
  for (const usage of usages) {
    const key = `${usage.carrier.getSourceFile().getFilePath()}:${usage.carrier.getStart()}`;
    const group = groups.get(key) ?? [];
    group.push(usage);
    groups.set(key, group);
  }
  return groups;
}

// A literal that spreads another entity may get its name from the spread, which only the checker sees.
function nameFromSpreadType(literal: ObjectLiteralExpression): string | undefined {
  if (!literal.getProperties().some((property) => Node.isSpreadAssignment(property))) {
    return undefined;
  }
  const property = literal.getType().getProperty("name");
  const type = property?.getTypeAtLocation(literal);
  const value = type?.isStringLiteral() ? type.getLiteralValue() : undefined;
  return typeof value === "string" ? value : undefined;
}

// Name already on the carrier, else the first name found for it.
function canonicalNameOf(
  literal: ObjectLiteralExpression,
  usages: readonly Usage[],
): { readonly name: string; readonly insertedBy: Usage | undefined } | { readonly why: string } {
  const existing = literal.getProperty("name");
  if (existing !== undefined) {
    const value = Node.isPropertyAssignment(existing)
      ? existing.getInitializer()
      : Node.isShorthandPropertyAssignment(existing)
        ? existing.getNameNode()
        : undefined;
    const name = value === undefined ? undefined : nameValueOf(value);
    return name === undefined
      ? { why: "the entity name is not a string literal, move the names by hand" }
      : { name, insertedBy: undefined };
  }
  const fromSpread = nameFromSpreadType(literal);
  if (fromSpread !== undefined) return { name: fromSpread, insertedBy: undefined };
  const first = usages.find((usage) => usage.nameValue !== undefined);
  return first?.nameValue === undefined
    ? { why: NAME_NOT_LITERAL }
    : { name: first.nameValue, insertedBy: first };
}

export function transformEntityNames(
  project: Project,
  filePaths: readonly string[],
): Map<string, CodemodResult> {
  const results: FileResults = new Map();
  const usages: Usage[] = [];
  for (const path of filePaths) {
    const sourceFile = project.getSourceFile(path);
    if (sourceFile === undefined) continue;
    const key = sourceFile.getFilePath();
    const collector = new Collector(key, sourceFile);
    collector.collect();
    usages.push(...collector.usages);
    const target = resultsFor(results, key);
    target.manual.push(...collector.manual);
    target.edits.push(...collector.directEdits);
    target.rewrites.push(...collector.directRewrites);
  }

  for (const group of groupByCarrier(usages).values()) {
    const [first] = group;
    if (first === undefined) continue;
    const literal = first.carrier;
    const carrierFile = literal.getSourceFile().getFilePath();
    const canonical = canonicalNameOf(literal, group);
    if ("why" in canonical) {
      for (const usage of group) {
        const file = usage.call.getSourceFile().getFilePath();
        resultsFor(results, file).manual.push({
          file,
          line: usage.call.getStartLineNumber(),
          description: `${usage.label}: ${canonical.why}`,
        });
      }
      continue;
    }
    if (canonical.insertedBy !== undefined) {
      const target = resultsFor(results, carrierFile);
      target.edits.push(nameInsertion(literal, insertedNameText(canonical.insertedBy)));
      target.rewrites.push({
        file: carrierFile,
        line: literal.getStartLineNumber(),
        description: `createEntity: name ${quoted(canonical.name)} added`,
      });
    }
    for (const usage of group) {
      const file = usage.call.getSourceFile().getFilePath();
      const target = resultsFor(results, file);
      target.edits.push(...usage.edits(canonical.name));
      target.rewrites.push({
        file,
        line: usage.call.getStartLineNumber(),
        description:
          usage.nameValue === canonical.name
            ? `${usage.label}: name argument dropped`
            : `${usage.label}: second name ${usage.nameExpression.getText()} spread onto the entity`,
      });
    }
  }

  const output = new Map<string, CodemodResult>();
  for (const [file, { edits, rewrites, manual }] of results) {
    const source = project.getSourceFile(file)?.getFullText() ?? "";
    output.set(file, { output: applyEdits(source, edits), rewrites, manual });
  }
  return output;
}

const analysisByRoot = new Map<string, Map<string, CodemodResult>>();

function analyseRoot(projectRoot: string): Map<string, CodemodResult> {
  const cached = analysisByRoot.get(projectRoot);
  if (cached !== undefined) return cached;
  const tsconfig = join(projectRoot, "tsconfig.json");
  const project = createTypeAwareProject(existsSync(tsconfig) ? tsconfig : undefined);
  const files = collectSourceFiles([projectRoot], {
    isMigratableFile: (name) => /\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts"),
  }).filter((file) => !file.includes("/__tests__/fixtures/"));
  for (const file of files) project.addSourceFileAtPath(file);
  const analysed = transformEntityNames(project, files);
  analysisByRoot.set(projectRoot, analysed);
  return analysed;
}

// The analysis spans the whole project root, so edits to an entity declaration reach files outside
// the directory that was passed in only when that directory covers them.
export function transformEntityNameSource(
  source: string,
  filePath: string,
  projectRoot: string,
): CodemodResult {
  if (!CHEAP_PREFILTER.test(source)) return { output: source, rewrites: [], manual: [] };
  const found = analyseRoot(projectRoot).get(resolve(filePath));
  return found ?? { output: source, rewrites: [], manual: [] };
}

function isSkippedPath(file: string): boolean {
  return (
    file.includes("/__tests__/fixtures/") ||
    file.endsWith("packages/feature-ast/src/scripts/codemod/entity-name.ts") ||
    file.endsWith("packages/feature-ast/src/__tests__/entity-name-codemod.test.ts")
  );
}

if (import.meta.main) {
  await runCodemodCli(
    { name: "entity-name", transform: transformEntityNameSource, isSkippedPath },
    process.argv.slice(2),
  );
}
