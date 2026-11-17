#!/usr/bin/env bun
// define-handler: handlers typed `WriteHandlerDef`/`QueryHandlerDef` move to
// `defineWriteHandler`/`defineQueryHandler`. The payload is typed from the schema, so the
// `event.payload as z.infer<typeof schema>` cast and the `schema.parse(event.payload)` re-parse on the
// handler's own schema go away. A handler is converted only when every use in the project accepts the
// typed definition; anything else is reported as manual and left untouched.
//
// Usage:
//   bun scripts/codemod/define-handler.ts <targetDir...> [--check | --dry-run | --write] [--no-format]

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  type ArrowFunction,
  type CallExpression,
  type FunctionDeclaration,
  type FunctionExpression,
  type Identifier,
  type ImportDeclaration,
  type MethodDeclaration,
  Node,
  type ObjectLiteralExpression,
  type Project,
  type SourceFile,
  SyntaxKind,
  type TypeAliasDeclaration,
  type TypeNode,
} from "ts-morph";
import {
  applyEdits,
  type CodemodResult,
  type CodemodSite,
  runCodemodCli,
  type TextEdit,
} from "./codemod-support.ts";
import { collectSourceFiles } from "./collect-source-files.ts";
import { createTypeAwareProject } from "./type-aware-project.ts";

type HandlerKind = "Write" | "Query";
type FunctionLike = FunctionDeclaration | FunctionExpression | ArrowFunction | MethodDeclaration;
type HandlerFunction = ArrowFunction | FunctionExpression | MethodDeclaration;

interface Span {
  readonly start: number;
  readonly end: number;
}

const ENGINE_MODULE = "@cosmicdrift/kumiko-framework/engine";
const CHEAP_PREFILTER = /\b(?:Write|Query)HandlerDef\b/;
const KIND_BY_TYPE_NAME = new Map<string, HandlerKind>([
  ["WriteHandlerDef", "Write"],
  ["QueryHandlerDef", "Query"],
]);
const REGISTRAR_VERBS = new Set(["writeHandler", "queryHandler"]);
const CAP_WRAPPERS = new Set(["withCapEnforcement", "withStockCap"]);
const INFER_TYPE_NAMES = new Set(["z.infer", "z.output", "z.TypeOf"]);

function defTypeName(kind: HandlerKind): string {
  return `${kind}HandlerDef`;
}

function defineName(kind: HandlerKind): string {
  return `define${kind}Handler`;
}

function kindOf(typeNode: TypeNode | undefined): HandlerKind | undefined {
  return typeNode === undefined ? undefined : KIND_BY_TYPE_NAME.get(typeNode.getText());
}

function isFunctionLike(node: Node): node is FunctionLike {
  return (
    Node.isFunctionDeclaration(node) ||
    Node.isArrowFunction(node) ||
    Node.isMethodDeclaration(node) ||
    Node.isFunctionExpression(node)
  );
}

function unwrapParens(node: Node | undefined): Node | undefined {
  let current = node;
  while (current !== undefined && Node.isParenthesizedExpression(current)) {
    current = current.getExpression();
  }
  return current;
}

function outermostParenthesised(node: Node): Node {
  let current = node;
  for (;;) {
    const parent = current.getParent();
    if (parent === undefined || !Node.isParenthesizedExpression(parent)) return current;
    current = parent;
  }
}

function manualSite(node: Node, description: string): CodemodSite {
  return { file: node.getSourceFile().getFilePath(), line: node.getStartLineNumber(), description };
}

// --- literal analysis -------------------------------------------------------------------------

interface LiteralPlan {
  readonly schemaName: string | undefined;
  readonly handler: HandlerFunction | undefined;
  readonly payloadParameter: string | undefined;
}

function isConditionalSpread(expression: Node): boolean {
  const inner = unwrapParens(expression);
  if (inner === undefined || !Node.isBinaryExpression(inner)) return false;
  const right = unwrapParens(inner.getRight());
  return (
    inner.getOperatorToken().getKind() === SyntaxKind.AmpersandAmpersandToken &&
    right !== undefined &&
    Node.isObjectLiteralExpression(right)
  );
}

function propertyProblem(literal: ObjectLiteralExpression): string | undefined {
  for (const property of literal.getProperties()) {
    if (Node.isSpreadAssignment(property)) {
      if (!isConditionalSpread(property.getExpression())) {
        return "the literal spreads another value into the handler";
      }
      continue;
    }
    if (
      !(
        Node.isPropertyAssignment(property) ||
        Node.isShorthandPropertyAssignment(property) ||
        Node.isMethodDeclaration(property)
      )
    ) {
      return "the literal has an accessor";
    }
    const nameNode = property.getNameNode();
    if (Node.isComputedPropertyName(nameNode)) return "the literal has a computed key";
    if (nameNode.getText() === "excludedFields") return "the literal carries excludedFields";
  }
  return undefined;
}

function schemaExpression(literal: ObjectLiteralExpression): Node | undefined {
  const property = literal.getProperty("schema");
  if (property === undefined) return undefined;
  if (Node.isPropertyAssignment(property)) return property.getInitializer();
  if (Node.isShorthandPropertyAssignment(property)) return property.getNameNode();
  return undefined;
}

function rootOf(expression: Node): { readonly root: Node; readonly hasCall: boolean } {
  let current = expression;
  let hasCall = false;
  for (;;) {
    if (Node.isCallExpression(current)) {
      hasCall = true;
      current = current.getExpression();
    } else if (
      Node.isPropertyAccessExpression(current) ||
      Node.isElementAccessExpression(current) ||
      Node.isNonNullExpression(current) ||
      Node.isParenthesizedExpression(current)
    ) {
      current = current.getExpression();
    } else {
      return { root: current, hasCall };
    }
  }
}

function isLocalBinding(identifier: Identifier): boolean {
  // A shorthand `{ schema }` names the property; the binding it reads is the value symbol.
  const parent = identifier.getParent();
  const symbol =
    parent !== undefined && Node.isShorthandPropertyAssignment(parent)
      ? parent.getValueSymbol()
      : identifier.getSymbol();
  const declarations = symbol?.getDeclarations() ?? [];
  return declarations.some(
    (declaration) =>
      Node.isParameterDeclaration(declaration) ||
      (Node.isVariableDeclaration(declaration) &&
        declaration.getFirstAncestor(isFunctionLike) !== undefined),
  );
}

function isDynamicSchema(expression: Node): boolean {
  const { root, hasCall } = rootOf(expression);
  if (!Node.isIdentifier(root)) return true;
  return isLocalBinding(root) || (hasCall && root.getText() !== "z");
}

function handlerFunctionOf(literal: ObjectLiteralExpression): HandlerFunction | undefined {
  const property = literal.getProperty("handler");
  if (property === undefined) return undefined;
  if (Node.isMethodDeclaration(property)) return property;
  if (!Node.isPropertyAssignment(property)) return undefined;
  const initializer = property.getInitializer();
  return initializer !== undefined &&
    (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))
    ? initializer
    : undefined;
}

function planLiteral(literal: ObjectLiteralExpression): LiteralPlan | string {
  const problem = propertyProblem(literal);
  if (problem !== undefined) return problem;
  const schema = schemaExpression(literal);
  if (schema === undefined) return "the literal has no schema property";
  if (isDynamicSchema(schema)) return "the schema is built dynamically";
  const handler = handlerFunctionOf(literal);
  const firstParameter = handler?.getParameters()[0];
  if (firstParameter?.getTypeNode() !== undefined) {
    return "the handler annotates its first parameter";
  }
  const parameterName = firstParameter?.getNameNode();
  const unwrappedSchema = unwrapParens(schema);
  return {
    schemaName:
      unwrappedSchema !== undefined && Node.isIdentifier(unwrappedSchema)
        ? unwrappedSchema.getText()
        : undefined,
    handler,
    payloadParameter:
      parameterName !== undefined && Node.isIdentifier(parameterName)
        ? parameterName.getText()
        : undefined,
  };
}

// --- candidates ---------------------------------------------------------------------------------

interface Candidate {
  readonly file: SourceFile;
  readonly kind: HandlerKind;
  readonly anchor: Node;
  readonly typeNode: TypeNode;
  readonly nameNode: Identifier | undefined;
  readonly fn: FunctionLike | undefined;
  // The expression that holds the literal (possibly parenthesised); undefined for forwarders.
  readonly returned: Node | undefined;
  readonly forwardedCall: CallExpression | undefined;
  plan: LiteralPlan | undefined;
  problem: string | undefined;
  readonly links: Candidate[];
}

interface FileCandidates {
  readonly candidates: Candidate[];
  readonly manual: CodemodSite[];
}

function nameNodeOfFunction(fn: FunctionLike): Identifier | undefined {
  if (Node.isFunctionDeclaration(fn)) return fn.getNameNode();
  const parent = fn.getParent();
  if (parent === undefined || !Node.isVariableDeclaration(parent)) return undefined;
  if (parent.getInitializer() !== fn) return undefined;
  const name = parent.getNameNode();
  return Node.isIdentifier(name) ? name : undefined;
}

function returnedExpressions(fn: FunctionLike): (Node | undefined)[] {
  if (Node.isArrowFunction(fn) && !Node.isBlock(fn.getBody())) return [fn.getBody()];
  return fn
    .getDescendantsOfKind(SyntaxKind.ReturnStatement)
    .filter((statement) => statement.getFirstAncestor(isFunctionLike) === fn)
    .map((statement) => statement.getExpression());
}

function withPlan(candidate: Candidate, literal: ObjectLiteralExpression): Candidate {
  const plan = planLiteral(literal);
  if (typeof plan === "string") candidate.problem = plan;
  else candidate.plan = plan;
  return candidate;
}

function variableCandidates(sourceFile: SourceFile, found: FileCandidates): void {
  for (const declaration of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const typeNode = declaration.getTypeNode();
    const kind = kindOf(typeNode);
    if (typeNode === undefined || kind === undefined) continue;
    const initializer = declaration.getInitializer();
    const literal = unwrapParens(initializer);
    if (
      initializer === undefined ||
      literal === undefined ||
      !Node.isObjectLiteralExpression(literal)
    ) {
      found.manual.push(
        manualSite(declaration, `${defTypeName(kind)}: the initializer is not an object literal`),
      );
      continue;
    }
    const nameNode = declaration.getNameNode();
    found.candidates.push(
      withPlan(
        {
          file: sourceFile,
          kind,
          anchor: declaration,
          typeNode,
          nameNode: Node.isIdentifier(nameNode) ? nameNode : undefined,
          fn: undefined,
          returned: initializer,
          forwardedCall: undefined,
          plan: undefined,
          problem: undefined,
          links: [],
        },
        literal,
      ),
    );
  }
}

function assertionManuals(sourceFile: SourceFile, found: FileCandidates): void {
  for (const expression of [
    ...sourceFile.getDescendantsOfKind(SyntaxKind.SatisfiesExpression),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.AsExpression),
  ]) {
    const kind = kindOf(expression.getTypeNode());
    if (kind === undefined) continue;
    found.manual.push(
      manualSite(expression, `${defTypeName(kind)}: satisfies/as form, type the handler by hand`),
    );
  }
}

function functionCandidate(
  sourceFile: SourceFile,
  fn: FunctionLike,
  typeNode: TypeNode,
  kind: HandlerKind,
  found: FileCandidates,
): void {
  const reject = (why: string): void => {
    found.manual.push(manualSite(fn, `${defTypeName(kind)} return type: ${why}`));
  };
  if (Node.isMethodDeclaration(fn)) {
    reject("methods are not converted");
    return;
  }
  if (Node.isFunctionDeclaration(fn) && fn.getBody() === undefined) {
    reject("overload signature");
    return;
  }
  const returns = returnedExpressions(fn);
  const returned = returns[0];
  const inner = unwrapParens(returned);
  if (returns.length !== 1 || returned === undefined || inner === undefined) {
    reject("the function does not have exactly one return with a value");
    return;
  }
  const nameNode = nameNodeOfFunction(fn);
  if (nameNode === undefined) {
    reject("the function has no name to track its uses");
    return;
  }
  const base = {
    file: sourceFile,
    kind,
    anchor: fn,
    typeNode,
    nameNode,
    fn,
    plan: undefined,
    problem: undefined,
    links: [],
  };
  if (Node.isObjectLiteralExpression(inner)) {
    found.candidates.push(withPlan({ ...base, returned, forwardedCall: undefined }, inner));
    return;
  }
  if (Node.isCallExpression(inner) && Node.isIdentifier(inner.getExpression())) {
    found.candidates.push({ ...base, returned: undefined, forwardedCall: inner });
    return;
  }
  reject("the function does not return an object literal");
}

function linkForwarders(candidates: readonly Candidate[]): void {
  for (const candidate of candidates) {
    if (candidate.forwardedCall === undefined) continue;
    const calleeName = candidate.forwardedCall.getExpression().getText();
    const target = candidates.find(
      (other) =>
        other !== candidate &&
        other.fn !== undefined &&
        other.kind === candidate.kind &&
        other.nameNode?.getText() === calleeName,
    );
    if (target === undefined) {
      candidate.problem = `the returned ${calleeName}() is no handler factory of this file`;
      continue;
    }
    candidate.links.push(target);
    target.links.push(candidate);
  }
}

function collectCandidates(sourceFile: SourceFile): FileCandidates {
  const found: FileCandidates = { candidates: [], manual: [] };
  variableCandidates(sourceFile, found);
  assertionManuals(sourceFile, found);
  for (const fn of sourceFile.getDescendants().filter(isFunctionLike)) {
    const typeNode = fn.getReturnTypeNode();
    const kind = kindOf(typeNode);
    if (typeNode !== undefined && kind !== undefined) {
      functionCandidate(sourceFile, fn, typeNode, kind, found);
    }
  }
  linkForwarders(found.candidates);
  return found;
}

// --- uses ---------------------------------------------------------------------------------------

type Verdict =
  | { readonly ok: true; readonly link: Candidate | undefined }
  | { readonly ok: false; readonly why: string };

const ALLOWED: Verdict = { ok: true, link: undefined };

function rejected(use: Node, what: string): Verdict {
  return {
    ok: false,
    why: `used as ${what} at ${use.getSourceFile().getFilePath()}:${use.getStartLineNumber()}`,
  };
}

function isAcceptingCall(call: CallExpression, use: Node): boolean {
  const callee = call.getExpression();
  if (Node.isPropertyAccessExpression(callee)) return REGISTRAR_VERBS.has(callee.getName());
  return (
    Node.isIdentifier(callee) &&
    CAP_WRAPPERS.has(callee.getText()) &&
    call.getArguments()[0] === use
  );
}

function forwardingOwner(
  use: Node,
  byFunction: ReadonlyMap<Node, Candidate>,
): Candidate | undefined {
  const outer = outermostParenthesised(use);
  const parent = outer.getParent();
  if (parent === undefined) return undefined;
  let fn: FunctionLike | undefined;
  if (Node.isReturnStatement(parent)) fn = parent.getFirstAncestor(isFunctionLike);
  else if (Node.isArrowFunction(parent) && parent.getBody() === outer) fn = parent;
  const owner = fn === undefined ? undefined : byFunction.get(fn);
  return owner !== undefined && owner.forwardedCall === use ? owner : undefined;
}

function classifyUse(use: Node, byFunction: ReadonlyMap<Node, Candidate>): Verdict {
  const parent = use.getParent();
  if (parent === undefined) return rejected(use, "an unknown node");
  if (Node.isPropertyAccessExpression(parent) && parent.getExpression() === use) return ALLOWED;
  if (
    Node.isCallExpression(parent) &&
    parent.getArguments().includes(use) &&
    isAcceptingCall(parent, use)
  ) {
    return ALLOWED;
  }
  const owner = forwardingOwner(use, byFunction);
  if (owner !== undefined) return { ok: true, link: owner };
  return rejected(use, `${parent.getKindName()}, not a registrar call, re-export or cap wrapper`);
}

function classifyReference(
  candidate: Candidate,
  reference: Node,
  byFunction: ReadonlyMap<Node, Candidate>,
): Verdict {
  const parent = reference.getParent();
  if (parent !== undefined && (Node.isImportSpecifier(parent) || Node.isExportSpecifier(parent))) {
    return ALLOWED;
  }
  if (candidate.fn === undefined) return classifyUse(reference, byFunction);
  const isCalled =
    parent !== undefined && Node.isCallExpression(parent) && parent.getExpression() === reference;
  if (isCalled) {
    return classifyUse(parent, byFunction);
  }
  return rejected(reference, "a function reference that is not called");
}

function useProblem(candidate: Candidate, byFunction: ReadonlyMap<Node, Candidate>): void {
  const name = candidate.nameNode;
  if (name === undefined) return;
  for (const reference of name.findReferencesAsNodes()) {
    if (reference.getSourceFile() === candidate.file && reference.getStart() === name.getStart()) {
      continue;
    }
    const verdict = classifyReference(candidate, reference, byFunction);
    if (!verdict.ok) {
      candidate.problem = verdict.why;
      return;
    }
    const partner = verdict.link;
    if (partner !== undefined && !candidate.links.includes(partner)) {
      candidate.links.push(partner);
      partner.links.push(candidate);
    }
  }
}

function spreadProblems(candidates: readonly Candidate[]): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of candidates) {
      if (candidate.problem !== undefined) continue;
      const blocked = candidate.links.find((other) => other.problem !== undefined);
      if (blocked === undefined) continue;
      candidate.problem = `tied to ${blocked.nameNode?.getText() ?? "a handler"} that stays erased`;
      changed = true;
    }
  }
}

// --- edits --------------------------------------------------------------------------------------

interface FileState {
  readonly sourceFile: SourceFile;
  readonly edits: TextEdit[];
  readonly removed: Span[];
  readonly aliases: Set<TypeAliasDeclaration>;
  readonly wrapped: Set<HandlerKind>;
  readonly commentStarts: Set<number>;
  readonly rewrites: CodemodSite[];
  readonly manual: CodemodSite[];
  castsRemoved: boolean;
  converted: boolean;
}

function newState(sourceFile: SourceFile): FileState {
  return {
    sourceFile,
    edits: [],
    removed: [],
    aliases: new Set(),
    wrapped: new Set(),
    commentStarts: new Set(),
    rewrites: [],
    manual: [],
    castsRemoved: false,
    converted: false,
  };
}

function spanOf(node: Node): Span {
  return { start: node.getStart(), end: node.getEnd() };
}

function annotationStart(typeNode: TypeNode): number {
  const text = typeNode.getSourceFile().getFullText();
  let index = typeNode.getStart() - 1;
  while (index > 0 && /\s/.test(text.charAt(index))) index -= 1;
  return text.charAt(index) === ":" ? index : typeNode.getStart();
}

function wrapEdits(expression: Node, kind: HandlerKind): TextEdit[] {
  const open = `${defineName(kind)}(`;
  const start = expression.getStart();
  if (Node.isParenthesizedExpression(expression)) return [{ start, end: start + 1, text: open }];
  return [
    { start, end: start, text: open },
    { start: expression.getEnd(), end: expression.getEnd(), text: ")" },
  ];
}

function isPayloadAccess(node: Node, parameter: string): boolean {
  return (
    Node.isPropertyAccessExpression(node) &&
    node.getName() === "payload" &&
    node.getExpression().getText() === parameter
  );
}

function inferredSchemaOf(typeNode: TypeNode | undefined): string | undefined {
  if (typeNode === undefined || !Node.isTypeReference(typeNode)) return undefined;
  if (!INFER_TYPE_NAMES.has(typeNode.getTypeName().getText())) return undefined;
  const [argument, ...rest] = typeNode.getTypeArguments();
  if (argument === undefined || rest.length > 0 || !Node.isTypeQuery(argument)) return undefined;
  return argument.getExprName().getText();
}

function castMatch(
  typeNode: TypeNode | undefined,
  schemaName: string | undefined,
  sourceFile: SourceFile,
): { readonly alias: TypeAliasDeclaration | undefined } | undefined {
  if (schemaName === undefined || typeNode === undefined) return undefined;
  if (inferredSchemaOf(typeNode) === schemaName) return { alias: undefined };
  if (!Node.isTypeReference(typeNode) || typeNode.getTypeArguments().length > 0) return undefined;
  const alias = sourceFile.getTypeAlias(typeNode.getTypeName().getText());
  return alias !== undefined && inferredSchemaOf(alias.getTypeNode()) === schemaName
    ? { alias }
    : undefined;
}

function enclosingStatement(node: Node): Node | undefined {
  let current = node;
  for (;;) {
    const parent = current.getParent();
    if (parent === undefined || isFunctionLike(parent)) return undefined;
    if (Node.isBlock(parent) || Node.isSourceFile(parent)) return current;
    current = parent;
  }
}

// The marker comment sits directly above the statement that holds the cast and goes with it.
function castBoundaryComment(statement: Node): Span | undefined {
  const text = statement.getSourceFile().getFullText();
  const ranges = statement.getLeadingCommentRanges();
  let firstIndex = ranges.length;
  let cursor = statement.getStart();
  for (let index = ranges.length - 1; index >= 0; index -= 1) {
    const range = ranges[index];
    if (range === undefined || range.getKind() !== SyntaxKind.SingleLineCommentTrivia) break;
    if (/\n\s*\n/.test(text.slice(range.getEnd(), cursor))) break;
    firstIndex = index;
    cursor = range.getPos();
  }
  const group = ranges.slice(firstIndex);
  const first = group[0];
  if (first === undefined || !group.some((range) => range.getText().includes("@cast-boundary"))) {
    return undefined;
  }
  return { start: first.getPos(), end: statement.getStart() };
}

function removeCast(cast: Node, expression: Node, state: FileState): void {
  state.edits.push({ ...spanOf(cast), text: expression.getText() });
  state.removed.push(spanOf(cast));
  state.castsRemoved = true;
  const statement = enclosingStatement(cast);
  const comment = statement === undefined ? undefined : castBoundaryComment(statement);
  if (comment === undefined || state.commentStarts.has(comment.start)) return;
  state.commentStarts.add(comment.start);
  state.edits.push({ ...comment, text: "" });
}

function removePayloadCasts(
  handler: Node,
  parameter: string,
  schemaName: string | undefined,
  state: FileState,
): void {
  for (const cast of handler.getDescendantsOfKind(SyntaxKind.AsExpression)) {
    if (!isPayloadAccess(cast.getExpression(), parameter)) continue;
    const match = castMatch(cast.getTypeNode(), schemaName, state.sourceFile);
    if (match === undefined) {
      state.manual.push(
        manualSite(cast, "payload cast does not match the schema, the definition is converted"),
      );
      continue;
    }
    removeCast(cast, cast.getExpression(), state);
    if (match.alias !== undefined) state.aliases.add(match.alias);
  }
}

function unwrapSchemaParseOfPayload(
  handler: Node,
  parameter: string,
  schemaName: string,
  state: FileState,
): void {
  for (const call of handler.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (
      !Node.isPropertyAccessExpression(callee) ||
      callee.getName() !== "parse" ||
      callee.getExpression().getText() !== schemaName
    ) {
      continue;
    }
    const [argument, ...rest] = call.getArguments();
    if (argument === undefined || rest.length > 0) continue;
    if (!isPayloadAccess(argument, parameter)) continue;
    state.edits.push({ ...spanOf(call), text: argument.getText() });
  }
}

function rewritePayloadUses(plan: LiteralPlan, state: FileState): void {
  const { handler, payloadParameter: parameter, schemaName } = plan;
  if (handler === undefined || parameter === undefined) return;
  removePayloadCasts(handler, parameter, schemaName, state);
  if (schemaName === undefined) return;
  unwrapSchemaParseOfPayload(handler, parameter, schemaName, state);
}

function applyCandidate(candidate: Candidate, state: FileState): void {
  const { typeNode } = candidate;
  const annotation = { start: annotationStart(typeNode), end: typeNode.getEnd() };
  state.edits.push({ ...annotation, text: "" });
  state.removed.push(annotation);
  state.converted = true;
  if (candidate.returned !== undefined && candidate.plan !== undefined) {
    state.edits.push(...wrapEdits(candidate.returned, candidate.kind));
    state.wrapped.add(candidate.kind);
    rewritePayloadUses(candidate.plan, state);
  }
  const name = candidate.nameNode?.getText();
  state.rewrites.push({
    file: candidate.file.getFilePath(),
    line: candidate.anchor.getStartLineNumber(),
    description:
      candidate.returned === undefined
        ? `${name ?? "handler"}: ${defTypeName(candidate.kind)} annotation dropped`
        : `${name ?? "handler"}: literal wrapped in ${defineName(candidate.kind)}`,
  });
}

// --- clean-up and imports -----------------------------------------------------------------------

function isInside(node: Node, spans: readonly Span[]): boolean {
  return spans.some((span) => node.getStart() >= span.start && node.getEnd() <= span.end);
}

function usesOutside(sourceFile: SourceFile, name: string, spans: readonly Span[]): number {
  return sourceFile.getDescendantsOfKind(SyntaxKind.Identifier).filter((identifier) => {
    const parent = identifier.getParent();
    return (
      identifier.getText() === name &&
      identifier.getFirstAncestorByKind(SyntaxKind.ImportDeclaration) === undefined &&
      !(
        parent !== undefined &&
        Node.isPropertyAccessExpression(parent) &&
        parent.getNameNode() === identifier
      ) &&
      !isInside(identifier, spans)
    );
  }).length;
}

function dropUnusedAliases(state: FileState): void {
  const text = state.sourceFile.getFullText();
  for (const alias of state.aliases) {
    const span = { start: alias.getStart(true), end: alias.getEnd() };
    const uses = usesOutside(state.sourceFile, alias.getName(), [...state.removed, span]);
    if (uses > 0 || alias.isExported()) continue;
    state.removed.push(span);
    const end = span.end + (text.charAt(span.end) === "\n" ? 1 : 0);
    state.edits.push({ start: span.start, end, text: "" });
  }
}

type Removals = Map<ImportDeclaration, Set<string>>;

function markRemoval(removals: Removals, declaration: ImportDeclaration, name: string): void {
  const names = removals.get(declaration) ?? new Set<string>();
  names.add(name);
  removals.set(declaration, names);
}

function planRemovals(state: FileState): Removals {
  const removals: Removals = new Map();
  const { sourceFile } = state;
  for (const declaration of sourceFile.getImportDeclarations()) {
    const namespaceImport = declaration.getNamespaceImport();
    if (
      state.castsRemoved &&
      namespaceImport?.getText() === "z" &&
      declaration.getDefaultImport() === undefined &&
      usesOutside(sourceFile, "z", state.removed) === 0
    ) {
      markRemoval(removals, declaration, "*");
    }
    for (const specifier of declaration.getNamedImports()) {
      const name = specifier.getName();
      const isUnusedZ =
        state.castsRemoved &&
        name === "z" &&
        specifier.getAliasNode() === undefined &&
        usesOutside(sourceFile, "z", state.removed) === 0;
      const isUnusedDef =
        KIND_BY_TYPE_NAME.has(name) && usesOutside(sourceFile, name, state.removed) === 0;
      if (isUnusedZ || isUnusedDef) markRemoval(removals, declaration, name);
    }
  }
  return removals;
}

function findEngineImport(sourceFile: SourceFile): ImportDeclaration | undefined {
  const engine = sourceFile
    .getImportDeclarations()
    .filter(
      (declaration) =>
        declaration.getModuleSpecifierValue() === ENGINE_MODULE &&
        declaration.getNamespaceImport() === undefined &&
        declaration.getNamedImports().length > 0,
    );
  return engine.find((declaration) => !declaration.isTypeOnly()) ?? engine[0];
}

interface ImportEdit {
  readonly edit: TextEdit;
  readonly deletion: boolean;
}

function deletionOf(declaration: ImportDeclaration): ImportEdit {
  const text = declaration.getSourceFile().getFullText();
  const end = declaration.getEnd();
  return {
    edit: {
      start: declaration.getStart(),
      end: end + (text.charAt(end) === "\n" ? 1 : 0),
      text: "",
    },
    deletion: true,
  };
}

function importEdit(
  declaration: ImportDeclaration,
  remove: ReadonlySet<string>,
  add: readonly string[],
): ImportEdit {
  const named = declaration.getNamedImports();
  const defaultImport = declaration.getDefaultImport()?.getText();
  const typeOnly = declaration.isTypeOnly();
  if (declaration.getNamespaceImport() !== undefined) return deletionOf(declaration);
  const makesValueImport = typeOnly && add.length > 0;
  const kept = named
    .filter((specifier) => !remove.has(specifier.getName()))
    .map((specifier) =>
      makesValueImport && !specifier.isTypeOnly()
        ? `type ${specifier.getText()}`
        : specifier.getText(),
    );
  const members = [...kept, ...add];
  if (members.length === 0 && defaultImport === undefined) return deletionOf(declaration);
  const last = named[named.length - 1];
  if (!typeOnly && remove.size === 0 && last !== undefined) {
    return {
      edit: { start: last.getEnd(), end: last.getEnd(), text: `, ${add.join(", ")}` },
      deletion: false,
    };
  }
  const bindings = members.length > 0 ? `{ ${members.join(", ")} }` : undefined;
  const clause = [defaultImport, bindings]
    .filter((part): part is string => part !== undefined)
    .join(", ");
  const keyword = typeOnly && add.length === 0 ? "type " : "";
  return {
    edit: {
      start: declaration.getStart(),
      end: declaration.getEnd(),
      text: `import ${keyword}${clause} from ${declaration.getModuleSpecifier().getText()};`,
    },
    deletion: false,
  };
}

function additionsFor(state: FileState, target: ImportDeclaration | undefined): string[] {
  const present = new Set(
    (target?.getNamedImports() ?? [])
      .filter((specifier) => !specifier.isTypeOnly() && target?.isTypeOnly() === false)
      .map((specifier) => specifier.getName()),
  );
  return [...state.wrapped]
    .sort()
    .map(defineName)
    .filter((name) => !present.has(name));
}

function planImports(state: FileState): void {
  const { sourceFile } = state;
  const removals = planRemovals(state);
  const target = findEngineImport(sourceFile);
  const additions = additionsFor(state, target);
  const deletions: ImportEdit[] = [];
  for (const declaration of sourceFile.getImportDeclarations()) {
    const remove = removals.get(declaration) ?? new Set<string>();
    const add = declaration === target ? additions : [];
    if (remove.size === 0 && add.length === 0) continue;
    const planned = importEdit(declaration, remove, add);
    state.edits.push(planned.edit);
    if (planned.deletion) deletions.push(planned);
  }
  if (target !== undefined || additions.length === 0) return;
  const line = `import { ${additions.join(", ")} } from "${ENGINE_MODULE}";`;
  const replaced = deletions[0];
  if (replaced !== undefined) {
    const index = state.edits.indexOf(replaced.edit);
    state.edits.splice(index, 1, { ...replaced.edit, text: `${line}\n` });
    return;
  }
  const imports = sourceFile.getImportDeclarations();
  const lastImport = imports[imports.length - 1];
  state.edits.push(
    lastImport === undefined
      ? { start: 0, end: 0, text: `${line}\n` }
      : { start: lastImport.getEnd(), end: lastImport.getEnd(), text: `\n${line}` },
  );
}

function finishFile(state: FileState): void {
  if (!state.converted) return;
  dropUnusedAliases(state);
  planImports(state);
}

// --- driver -------------------------------------------------------------------------------------

export function isSkippedPath(file: string): boolean {
  return (
    file.includes("/__tests__/") ||
    /\.test\.tsx?$/.test(file) ||
    file.endsWith("packages/feature-ast/src/scripts/codemod/define-handler.ts")
  );
}

export function transformDefineHandlers(
  project: Project,
  files: readonly string[],
): Map<string, CodemodResult> {
  const states = new Map<string, FileState>();
  const all: Candidate[] = [];
  const byFunction = new Map<Node, Candidate>();
  for (const path of files) {
    if (isSkippedPath(path)) continue;
    const sourceFile = project.getSourceFile(path);
    if (sourceFile === undefined) continue;
    const state = newState(sourceFile);
    states.set(sourceFile.getFilePath(), state);
    const found = collectCandidates(sourceFile);
    state.manual.push(...found.manual);
    all.push(...found.candidates);
    for (const candidate of found.candidates) {
      if (candidate.fn !== undefined) byFunction.set(candidate.fn, candidate);
    }
  }
  for (const candidate of all) {
    if (candidate.problem === undefined) useProblem(candidate, byFunction);
  }
  spreadProblems(all);
  applyOrReportCandidates(all, states);
  return collectResults(states);
}

function applyOrReportCandidates(
  all: readonly Candidate[],
  states: ReadonlyMap<string, FileState>,
): void {
  for (const candidate of all) {
    const state = states.get(candidate.file.getFilePath());
    if (state === undefined) continue;
    if (candidate.problem === undefined) {
      applyCandidate(candidate, state);
      continue;
    }
    const name = candidate.nameNode === undefined ? "" : ` ${candidate.nameNode.getText()}`;
    state.manual.push(
      manualSite(
        candidate.anchor,
        `${defTypeName(candidate.kind)}${name} stays: ${candidate.problem}`,
      ),
    );
  }
}

function collectResults(states: ReadonlyMap<string, FileState>): Map<string, CodemodResult> {
  const output = new Map<string, CodemodResult>();
  for (const [file, state] of states) {
    finishFile(state);
    if (state.rewrites.length === 0 && state.manual.length === 0) continue;
    output.set(file, {
      output: applyEdits(state.sourceFile.getFullText(), state.edits),
      rewrites: state.rewrites,
      manual: state.manual,
    });
  }
  return output;
}

const analysisByRoot = new Map<string, Map<string, CodemodResult>>();

function analyseRoot(projectRoot: string): Map<string, CodemodResult> {
  const cached = analysisByRoot.get(projectRoot);
  if (cached !== undefined) return cached;
  const tsconfig = join(projectRoot, "tsconfig.json");
  const project = createTypeAwareProject(existsSync(tsconfig) ? tsconfig : undefined);
  // Test files are loaded so that their uses of a handler count; they are never rewritten.
  const files = collectSourceFiles([projectRoot], {
    isMigratableFile: (name) => /\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts"),
  }).filter((file) => !file.includes("/__tests__/fixtures/"));
  for (const file of files) project.addSourceFileAtPath(file);
  const analysed = transformDefineHandlers(project, files);
  analysisByRoot.set(projectRoot, analysed);
  return analysed;
}

export function transformDefineHandlerSource(
  source: string,
  filePath: string,
  projectRoot: string,
): CodemodResult {
  if (!CHEAP_PREFILTER.test(source)) return { output: source, rewrites: [], manual: [] };
  const unchanged = { output: source, rewrites: [], manual: [] };
  return analyseRoot(projectRoot).get(resolve(filePath)) ?? unchanged;
}

if (import.meta.main) {
  await runCodemodCli(
    { name: "define-handler", transform: transformDefineHandlerSource, isSkippedPath },
    process.argv.slice(2),
  );
}
